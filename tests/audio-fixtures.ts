export function wavFile() {
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
  when = 0;
  duration: number | undefined;
  start(when = 0, offset = 0, duration?: number) {
    this.when = when;
    this.offset = offset;
    this.duration = duration;
  }
  stop() {
    this.stopped = true;
  }
}
export class FakeParam {
  value = 0;
  events: { type: string; value?: number; time: number }[] = [];
  setTargetAtTime(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ type: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'ramp', value, time });
  }
  cancelScheduledValues(time: number) {
    this.events = this.events.filter((e) => e.time < time);
  }
}
class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
  when = 0;
  stopAt = Infinity;
  onended: (() => void) | null = null;
  start(when = 0) {
    this.when = when;
  }
  stop(at = 0) {
    this.stopAt = at;
  }
}
export class FakeContext {
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
  oscillators: FakeOscillator[] = [];
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: 'lowpass',
      frequency: new FakeParam(),
      Q: new FakeParam(),
    });
  }
  onstatechange: (() => void) | null = null;
  sinkId = '';
  master = Object.assign(new FakeNode(), {
    channelCount: 0,
    channelCountMode: '',
    channelInterpretation: '',
    gain: new FakeParam(),
  });
  gains: (typeof this.master)[] = [];
  resumeGate: Promise<void> | null = null;
  constructor(options: AudioContextOptions) {
    if (options.sampleRate === FakeContext.rejectSampleRate)
      throw new DOMException('Unsupported rate', 'NotSupportedError');
    this.sampleRate = options.sampleRate || 48000;
    FakeContext.instances.push(this);
  }
  createGain() {
    const gain =
      this.gains.length === 0
        ? this.master
        : Object.assign(new FakeNode(), {
            channelCount: 0,
            channelCountMode: '',
            channelInterpretation: '',
            gain: new FakeParam(),
          });
    this.gains.push(gain);
    return gain;
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
  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      length,
      numberOfChannels: channels,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    };
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
