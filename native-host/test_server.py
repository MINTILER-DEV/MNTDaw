"""Protocol tests; no installed VST3 or Pedalboard dependency needed."""
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from server import Handler, catalog, validate_render


class HostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Handler.token = 'test-only-token'
        Handler.origins = {'http://127.0.0.1:5173'}
        Handler.plugins = {'fixture': Path('Test.vst3')}
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path='/plugins', data=None, origin='http://127.0.0.1:5173', token='test-only-token', method='POST'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        connection.request(method, path, json.dumps(data or {}), {'Origin': origin, 'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), json.loads(response.read())
        connection.close()
        return result

    def test_pairing_requires_both_exact_origin_and_token(self):
        self.assertEqual(self.request(token='wrong')[0], 403)
        result = self.request(origin='https://unrelated.example')
        self.assertEqual(result[0], 403)
        self.assertNotIn('Access-Control-Allow-Origin', result[1])

    def test_catalog_and_cors_preflight(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(body, [{'id': 'fixture', 'name': 'Test'}])
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:5173')
        self.assertEqual(self.request(method='OPTIONS')[0], 200)

    def test_client_cannot_supply_an_arbitrary_plugin_path(self):
        status, _, body = self.request('/render', {'pluginId': 'C:/arbitrary.vst3'})
        self.assertEqual(status, 400)
        self.assertIn('not found', body['error'])

    def test_invalid_render_is_rejected_before_loading_native_code(self):
        self.assertEqual(self.request('/render', {'pluginId': 'fixture', 'duration': 301})[0], 400)
        self.assertEqual(self.request('/unknown')[0], 404)

    def test_render_bounds(self):
        valid = dict(duration=2, sampleRate=48000, parameters={'cutoff': .75}, notes=[dict(pitch=60, velocity=100, start=.5, duration=1)])
        self.assertEqual(validate_render(valid), valid)
        for patch in [dict(duration=float('nan')), dict(duration=-1), dict(sampleRate=8000), dict(parameters={'gain': 2}), dict(notes=[dict(pitch=128, velocity=100, start=0, duration=1)]), dict(notes=[dict(pitch=60, velocity=0, start=0, duration=1)]), dict(notes=[dict(pitch=60, velocity=100, start=1, duration=2)])]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_render({**valid, **patch})

    def test_bundle_scan_skips_internal_vst3_binaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inner = root / 'Synth.vst3' / 'Contents' / 'x86_64-win'
            inner.mkdir(parents=True)
            (inner / 'Synth.vst3').write_bytes(b'fixture')
            result = catalog([root])
            self.assertEqual(list(result.values()), [(root / 'Synth.vst3').resolve()])


if __name__ == '__main__':
    unittest.main()
