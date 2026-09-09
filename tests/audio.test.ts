import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../lib/audio-engine.ts';
import {
  dbToGain,
  formatTime,
  gainToDb,
  parseWav,
  waveformPeaks,
} from '../lib/audio-utils.ts';

function wavFile() {
  const bytes = new ArrayBuffer(52);
  const view = new DataView(bytes);
  const tag = (offset: number, text: string) =>
    text
      .split('')
      .forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 44, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 176400, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, 8, true);
  return bytes;
}

class FakeNode {
  connections: unknown[] = [];
  connect(node: unknown) {
    this.connections.push(node);
    return node;
  }
  disconnect() {
    this.connections = [];
  }
}
class FakeSource extends FakeNode {
  buffer: unknown;
  onended: (() => void) | null = null;
  offset = 0;
  stopped = false;
  start(_when: number, offset: number) {
    this.offset = offset;
  }
  stop() {
    this.stopped = true;
  }
}
class FakeContext {
  static instances: FakeContext[] = [];
  static rejectSampleRate = 0;
  static rejectDecode = false;
  currentTime = 0;
  state = 'suspended';
  sampleRate: number;
  baseLatency = 0.01;
  outputLatency = 0.02;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  onstatechange: (() => void) | null = null;
  sinkId = '';
  master = Object.assign(new FakeNode(), {
    channelCount: 0,
    channelCountMode: '',
    channelInterpretation: '',
    gain: {
      value: 0,
      setTargetAtTime(value: number) {
        this.value = value;
      },
    },
  });
  resumeGate: Promise<void> | null = null;
  constructor(options: AudioContextOptions) {
    if (options.sampleRate === FakeContext.rejectSampleRate)
      throw new DOMException('Unsupported rate', 'NotSupportedError');
    this.sampleRate = options.sampleRate || 48000;
    FakeContext.instances.push(this);
  }
  createGain() {
    return this.master;
  }
  createChannelSplitter() {
    return new FakeNode();
  }
  createAnalyser() {
    return Object.assign(new FakeNode(), {
      fftSize: 0,
      getFloatTimeDomainData(data: Float32Array) {
        data.fill(0.25);
      },
    });
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async decodeAudioData() {
    if (FakeContext.rejectDecode)
      throw new DOMException('Invalid data', 'EncodingError');
    return {
      duration: 10,
      length: 480000,
      numberOfChannels: 2,
      sampleRate: this.sampleRate,
    };
  }
  async resume() {
    if (this.resumeGate) await this.resumeGate;
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
  async setSinkId(id: string) {
    if (id === 'missing') throw new DOMException('Missing', 'NotFoundError');
    this.sinkId = id;
  }
}

beforeEach(() => {
  FakeContext.instances = [];
  FakeContext.rejectSampleRate = 0;
  FakeContext.rejectDecode = false;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
});
const load = async () => {
  const engine = new AudioEngine();
  await engine.load(new File([wavFile()], 'test.wav'));
  return engine;
};

void test('WAV metadata keeps original source sample rate and frame count', () => {
  assert.deepEqual(parseWav(wavFile()), {
    channels: 2,
    sampleRate: 44100,
    bitDepth: 16,
    frames: 2,
  });
});
void test('WAV parser rejects non-WAV input and truncated chunks', () => {
  assert.throws(() => parseWav(new ArrayBuffer(44)), /valid RIFF/);
  assert.throws(() => parseWav(wavFile().slice(0, 48)), /incomplete/);
});
void test('WAV parser respects odd-sized ancillary chunk padding', () => {
  const original = new Uint8Array(wavFile());
  const expanded = new Uint8Array(62);
  expanded.set(original.slice(0, 12));
  expanded.set([74, 85, 78, 75, 1, 0, 0, 0, 42, 0], 12);
  expanded.set(original.slice(12), 22);
  new DataView(expanded.buffer).setUint32(4, 54, true);
  assert.equal(parseWav(expanded.buffer).frames, 2);
});
void test('peak extraction preserves narrow transients and negative peaks', () => {
  const data = new Float32Array(1000);
  data[7] = 1;
  data[49] = -0.75;
  data[777] = 0.5;
  const peaks = waveformPeaks(data, 10);
  assert.deepEqual(peaks[0], [-0.75, 1]);
  assert.deepEqual(peaks[7], [0, 0.5]);
});
void test('gain and time formatting handle silence and minute boundaries', () => {
  assert.equal(dbToGain(0), 1);
  assert.equal(gainToDb(0), -Infinity);
  assert.ok(Math.abs(gainToDb(dbToGain(-6)) + 6) < 1e-9);
  assert.equal(formatTime(61.5, true), '01:01.500');
  assert.equal(formatTime(-10), '00:00');
});
void test('pause resumes at the retained playhead; stop resets it', async () => {
  const engine = await load();
  const context = FakeContext.instances[0];
  await engine.play();
  context.currentTime = 3;
  engine.pause();
  assert.equal(engine.position, 3);
  assert.equal(engine.getSnapshot().status, 'paused');
  context.currentTime = 8;
  await engine.play();
  assert.equal(context.sources.at(-1)!.offset, 3);
  context.currentTime = 9;
  assert.equal(engine.position, 4);
  engine.stop();
  assert.equal(engine.position, 0);
  assert.equal(engine.getSnapshot().status, 'stopped');
});
void test('seek restarts a playing source and clamps at the file boundary', async () => {
  const engine = await load();
  await engine.play();
  const oldSource = FakeContext.instances[0].sources[0];
  engine.seek(6);
  assert.equal(oldSource.stopped, true);
  assert.equal(oldSource.onended, null);
  assert.equal(engine.position, 6);
  assert.equal(engine.getSnapshot().status, 'playing');
  engine.seek(200);
  assert.equal(engine.position, 10);
  assert.equal(engine.getSnapshot().status, 'stopped');
  await engine.play();
  assert.equal(engine.position, 0);
});
void test('natural ending allows replay from the beginning', async () => {
  const engine = await load();
  await engine.play();
  FakeContext.instances[0].sources[0].onended!();
  assert.equal(engine.position, 10);
  assert.equal(engine.getSnapshot().status, 'stopped');
  await engine.play();
  assert.equal(FakeContext.instances[0].sources.at(-1)!.offset, 0);
});
void test('rejected settings leave the current source and settings untouched', async () => {
  const engine = await load();
  await engine.play();
  FakeContext.rejectSampleRate = 96000;
  await assert.rejects(
    engine.configure({ sampleRate: 96000, bufferSize: 128 }),
  );
  assert.equal(engine.getSnapshot().settings.sampleRate, 48000);
  assert.equal(engine.getSnapshot().status, 'playing');
  assert.equal(FakeContext.instances[0].sources[0].stopped, false);
});
void test('context replacement preserves playhead, output, gain, and mute', async () => {
  const engine = await load();
  await engine.setDevice('speakers');
  engine.setVolume(-12);
  engine.setMuted(true);
  await engine.play();
  FakeContext.instances[0].currentTime = 4;
  await engine.configure({ sampleRate: 44100, bufferSize: 1024 });
  const replacement = FakeContext.instances[1];
  assert.equal(FakeContext.instances[0].state, 'closed');
  assert.equal(replacement.sources[0].offset, 4);
  assert.equal(replacement.sinkId, 'speakers');
  assert.equal(replacement.master.gain.value, 0);
  assert.equal(replacement.master.channelCount, 2);
  assert.equal(engine.getSnapshot().status, 'playing');
  engine.setMuted(false);
  assert.equal(replacement.master.gain.value, dbToGain(-12));
});
void test('a failed file replacement retains loaded audio and playback', async () => {
  const engine = await load();
  await engine.play();
  FakeContext.rejectDecode = true;
  await assert.rejects(
    engine.load(new File([wavFile()], 'bad.wav')),
    /could not be decoded/,
  );
  assert.equal(engine.getSnapshot().fileName, 'test.wav');
  assert.equal(engine.getSnapshot().status, 'playing');
});
void test('stop cancels a pending asynchronous resume', async () => {
  const engine = await load();
  const context = FakeContext.instances[0];
  let release!: () => void;
  context.resumeGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const playback = engine.play();
  engine.stop();
  release();
  await playback;
  assert.equal(context.sources.length, 0);
  assert.equal(engine.getSnapshot().status, 'stopped');
});
void test('device failure preserves the previous successful output', async () => {
  const engine = await load();
  await engine.setDevice('speakers');
  await assert.rejects(engine.setDevice('missing'));
  assert.equal(engine.getSnapshot().deviceId, 'speakers');
});
void test('OS suspension pauses at the current position', async () => {
  const engine = await load();
  await engine.play();
  const context = FakeContext.instances[0];
  context.currentTime = 2;
  context.state = 'suspended';
  context.onstatechange!();
  assert.equal(engine.getSnapshot().status, 'paused');
  assert.equal(engine.position, 2);
  assert.deepEqual(engine.readLevels(), [0, 0]);
});
