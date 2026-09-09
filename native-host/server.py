"""Optional, loopback-only VST3 instrument renderer for MNT Studio."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import io
import json
import math
import multiprocessing as mp
import os
from pathlib import Path
import secrets
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def validate_render(data):
    duration = data.get('duration', 0)
    rate = data.get('sampleRate', 48000)
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= 300:
        raise ValueError('Render duration must be between 0 and 300 seconds.')
    if rate not in (44100, 48000, 96000):
        raise ValueError('Unsupported sample rate.')
    params = data.get('parameters', {})
    if not isinstance(params, dict) or len(params) > 4096:
        raise ValueError('Invalid parameters.')
    for name, value in params.items():
        if not isinstance(name, str) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            raise ValueError('Plugin parameters use normalized values from 0 to 1.')
    notes = data.get('notes', [])
    if not isinstance(notes, list) or len(notes) > 8192:
        raise ValueError('Maximum 8192 MIDI notes per render.')
    for note in notes:
        if not isinstance(note, dict):
            raise ValueError('Invalid MIDI note.')
        for field in ('pitch', 'velocity', 'start', 'duration'):
            value = note.get(field)
            if not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError('Invalid MIDI note value.')
        if not isinstance(note['pitch'], int) or not 0 <= note['pitch'] <= 127 or not isinstance(note['velocity'], int) or not 1 <= note['velocity'] <= 127:
            raise ValueError('Invalid MIDI pitch or velocity.')
        if note['start'] < 0 or note['duration'] <= 0 or note['start'] + note['duration'] > duration + .001:
            raise ValueError('MIDI note extends beyond the render.')
    return data


def catalog(roots):
    result = {}
    for root in roots:
        root = Path(root).expanduser().resolve()
        if not root.is_dir():
            continue
        for path in root.rglob('*.vst3'):
            resolved = path.resolve()
            if not resolved.is_relative_to(root) or any(p.suffix.lower() == '.vst3' for p in path.relative_to(root).parents):
                continue
            identifier = hashlib.sha256(str(resolved).encode()).hexdigest()[:24]
            result[identifier] = resolved
    return result


def worker(pipe, path, action, data):
    try:
        from pedalboard import load_plugin
        import numpy as np
        plugin = load_plugin(path)
        if not plugin.is_instrument:
            raise ValueError('Choose a VST3 instrument, not an audio effect.')
        if action == '/parameters':
            pipe.send(('json', [dict(id=name, name=name.replace('_', ' '), value=parameter.raw_value, label=parameter.label or '') for name, parameter in plugin.parameters.items()]))
            return
        for key, value in data.get('parameters', {}).items():
            if key not in plugin.parameters:
                raise ValueError(f'Plugin no longer exposes parameter: {key}')
            plugin.parameters[key].raw_value = value
        events = []
        for note in data['notes']:
            events.append((bytes([0x90, note['pitch'], note['velocity']]), note['start']))
            events.append((bytes([0x80, note['pitch'], 0]), note['start'] + note['duration']))
        events.sort(key=lambda event: (event[1], event[0][0]))
        rate = data.get('sampleRate', 48000)
        audio = plugin(events, duration=data['duration'], sample_rate=rate, num_channels=2, buffer_size=512, reset=True)
        encoded = (np.clip(audio.T, -1, 1) * 32767).astype('<i2').tobytes()
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(encoded)
        pipe.send(('wav', output.getvalue()))
    except Exception as exc:
        pipe.send(('error', str(exc)[:500]))
    finally:
        pipe.close()


def run_plugin(path, action, data):
    parent, child = mp.Pipe(duplex=False)
    process = mp.Process(target=worker, args=(child, str(path), action, data), daemon=True)
    process.start(); child.close()
    try:
        if not parent.poll(150):
            raise ValueError('The plugin timed out. Try another instrument or a shorter clip.')
        try:
            kind, payload = parent.recv()
        except EOFError:
            raise ValueError('The native plugin crashed while loading or rendering.') from None
        if kind == 'error':
            raise ValueError(payload)
        return kind, payload
    finally:
        parent.close()
        process.join(timeout=1)
        if process.is_alive():
            process.terminate(); process.join(timeout=2)


class Handler(BaseHTTPRequestHandler):
    token = ''
    origins = set()
    plugins = {}
    render_lock = threading.Lock()

    def log_message(self, *_):
        pass

    def reply(self, status, payload, kind='json'):
        encoded = json.dumps(payload).encode() if kind == 'json' else payload
        self.send_response(status)
        origin = self.headers.get('Origin', '')
        if origin in self.origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Content-Type', 'application/json' if kind == 'json' else 'audio/wav')
        self.send_header('Content-Length', str(len(encoded)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self):
        self.reply(200 if self.headers.get('Origin') in self.origins else 403, {})

    def do_POST(self):
        if self.headers.get('Origin') not in self.origins or not hmac.compare_digest(self.headers.get('Authorization', ''), f'Bearer {self.token}'):
            self.reply(403, {'error': 'Pair this DAW origin using the token printed by the native host.'}); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4 * 1024 * 1024:
                raise ValueError('Request exceeds 4 MB.')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Invalid request.')
            if self.path == '/plugins':
                self.reply(200, [dict(id=key, name=path.stem) for key, path in self.plugins.items()]); return
            if self.path not in ('/parameters', '/render'):
                self.reply(404, {'error': 'Unknown action.'}); return
            path = self.plugins.get(data.get('pluginId'))
            if not path:
                raise ValueError('Plugin not found in the configured VST3 folders. Restart the host to scan again.')
            if self.path == '/render':
                validate_render(data)
            with self.render_lock:
                kind, payload = run_plugin(path, self.path, data)
            self.reply(200, payload, kind)
        except (ValueError, TypeError, KeyError) as exc:
            self.reply(400, {'error': str(exc)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', action='append', help='Exact DAW origin to allow, including scheme and port. Repeat for multiple origins.')
    parser.add_argument('--plugin-dir', action='append', help='VST3 folder to scan. Repeat for multiple folders.')
    args = parser.parse_args()
    Handler.token = secrets.token_urlsafe(24)
    Handler.origins = set(args.origin or ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173'])
    defaults = [Path(os.environ.get('CommonProgramFiles', 'C:/Program Files/Common Files')) / 'VST3', Path.home() / '.vst3', Path('/Library/Audio/Plug-Ins/VST3')]
    Handler.plugins = catalog(args.plugin_dir or defaults)
    print(f'MNT native host: http://127.0.0.1:8765\nPairing token: {Handler.token}\nFound {len(Handler.plugins)} VST3 bundles. Allowed origins: {", ".join(Handler.origins)}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()


if __name__ == '__main__':
    mp.freeze_support()
    main()
