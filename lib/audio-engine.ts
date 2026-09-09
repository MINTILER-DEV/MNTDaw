import { dbToGain, parseWav, type WavInfo } from './audio-utils.ts';

type RoutableContext = AudioContext & {
  setSinkId?: (id: string) => Promise<void>;
};
export type AudioSettings = { sampleRate: number; bufferSize: number };
export type PlaybackTrack = {
  id: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  clips: {
    buffer: AudioBuffer;
    start: number;
    offset: number;
    duration: number;
  }[];
};
export type AudioSnapshot = {
  status: 'stopped' | 'playing' | 'paused';
  contextState: string;
  buffer: AudioBuffer | null;
  fileName: string;
  fileSize: number;
  wav: WavInfo | null;
  settings: AudioSettings;
  actualSampleRate: number | null;
  baseLatency: number | null;
  outputLatency: number | null;
  deviceId: string;
  volume: number;
  muted: boolean;
  duration: number;
};

export class AudioEngine {
  private context: RoutableContext | null = null;
  private master: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private analysers: AnalyserNode[] = [];
  private meterData: Float32Array<ArrayBuffer>[] = [];
  private source: AudioBufferSourceNode | null = null;
  private arrangement: PlaybackTrack[] | null = null;
  private scheduled: AudioBufferSourceNode[] = [];
  private trackGains: GainNode[] = [];
  private offset = 0;
  private startedAt = 0;
  private generation = 0;
  private listeners = new Set<() => void>();
  private state: AudioSnapshot = {
    status: 'stopped',
    contextState: 'idle',
    buffer: null,
    fileName: '',
    fileSize: 0,
    wav: null,
    settings: { sampleRate: 48000, bufferSize: 512 },
    actualSampleRate: null,
    baseLatency: null,
    outputLatency: null,
    deviceId: '',
    volume: -6,
    muted: false,
    duration: 0,
  };

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<AudioSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  get position() {
    if (this.state.status !== 'playing' || !this.context) return this.offset;
    return Math.min(
      this.state.duration,
      this.offset + this.context.currentTime - this.startedAt,
    );
  }

  get canSelectDevice() {
    return (
      typeof AudioContext !== 'undefined' &&
      'setSinkId' in AudioContext.prototype
    );
  }

  private async createContext(settings: AudioSettings) {
    if (typeof AudioContext === 'undefined')
      throw new Error(
        'Web Audio is unavailable. Open this workspace in a current browser.',
      );
    const context: RoutableContext = new AudioContext({
      ...(settings.sampleRate ? { sampleRate: settings.sampleRate } : {}),
      latencyHint:
        settings.bufferSize /
        (settings.sampleRate || this.state.actualSampleRate || 48000),
    });
    try {
      if (this.state.deviceId) {
        if (!context.setSinkId)
          throw new Error('This browser cannot select an output device.');
        await context.setSinkId(this.state.deviceId);
      }
      return context;
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  private attachContext(context: RoutableContext) {
    this.context = context;
    this.master = context.createGain();
    this.master.channelCount = 2;
    this.master.channelCountMode = 'explicit';
    this.master.channelInterpretation = 'speakers';
    this.master.gain.value = this.state.muted ? 0 : dbToGain(this.state.volume);
    this.master.connect(context.destination);
    this.splitter = context.createChannelSplitter(2);
    this.master.connect(this.splitter);
    this.analysers = [0, 1].map((channel) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      this.splitter!.connect(analyser, channel);
      return analyser;
    });
    this.meterData = this.analysers.map(() => new Float32Array(2048));
    context.onstatechange = () => {
      if (context !== this.context) return;
      if (context.state !== 'running' && this.state.status === 'playing')
        this.pause();
      this.update({ contextState: context.state });
    };
    this.update({
      contextState: context.state,
      actualSampleRate: context.sampleRate,
      baseLatency: context.baseLatency ?? null,
      outputLatency: context.outputLatency ?? null,
    });
  }

  private async ensureContext() {
    if (!this.context)
      this.attachContext(await this.createContext(this.state.settings));
    return this.context!;
  }

  async decodeFile(file: File) {
    if (file.size > 150 * 1024 * 1024)
      throw new Error('Choose a WAV smaller than 150 MB.');
    const bytes = await file.arrayBuffer();
    const wav = parseWav(bytes);
    const context = await this.ensureContext();
    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(bytes.slice(0));
    } catch {
      throw new Error(
        'This WAV could not be decoded. Try an uncompressed PCM or floating-point WAV.',
      );
    }
    if (!buffer.length) throw new Error('This WAV contains no audio.');
    return { buffer, wav, bytes };
  }

  async load(file: File) {
    const { buffer, wav } = await this.decodeFile(file);
    this.stop();
    this.arrangement = null;
    this.update({
      buffer,
      wav,
      fileName: file.name,
      fileSize: file.size,
      duration: buffer.duration,
    });
  }

  setArrangement(tracks: PlaybackTrack[], duration: number) {
    const playing = this.state.status === 'playing';
    const position = this.position;
    this.generation++;
    this.disconnectSource();
    this.arrangement = tracks;
    this.offset = Math.min(position, duration);
    this.update({ duration, status: playing ? 'paused' : this.state.status });
    if (playing && this.offset < duration) this.startSource();
  }

  private startArrangement() {
    const context = this.context!;
    const anySolo = this.arrangement!.some((track) => track.solo);
    // All clips share one audio-clock origin, including overlaps and future starts.
    const origin = context.currentTime;
    for (const track of this.arrangement!) {
      const gain = context.createGain();
      gain.gain.value =
        track.muted || (anySolo && !track.solo) ? 0 : dbToGain(track.volume);
      gain.connect(this.master!);
      this.trackGains.push(gain);
      for (const clip of track.clips) {
        const elapsed = Math.max(0, this.offset - clip.start);
        if (elapsed >= clip.duration) continue;
        const source = context.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(gain);
        source.start(
          origin + Math.max(0, clip.start - this.offset),
          clip.offset + elapsed,
          clip.duration - elapsed,
        );
        this.scheduled.push(source);
      }
    }
    // A silent boundary keeps the transport accurate through gaps and muted tracks.
    const boundary = context.createBufferSource();
    boundary.buffer = context.createBuffer(1, 1, context.sampleRate);
    boundary.connect(this.master!);
    boundary.onended = () => {
      if (this.source !== boundary) return;
      this.source = null;
      boundary.disconnect();
      this.disconnectSource();
      this.offset = this.state.duration;
      this.update({ status: 'stopped' });
    };
    this.source = boundary;
    this.startedAt = origin;
    boundary.start(origin + Math.max(0, this.state.duration - this.offset));
    this.update({ status: 'playing', contextState: context.state });
  }

  private disconnectSource() {
    this.scheduled.forEach((source) => {
      source.onended = null;
      source.stop();
      source.disconnect();
    });
    this.scheduled = [];
    this.trackGains.forEach((gain) => gain.disconnect());
    this.trackGains = [];
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }

  private startSource() {
    if (this.arrangement && this.context && this.master) {
      this.startArrangement();
      return;
    }
    if (!this.context || !this.master || !this.state.buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = this.state.buffer;
    source.connect(this.master);
    source.onended = () => {
      if (this.source !== source) return;
      source.disconnect();
      this.source = null;
      this.offset = this.state.duration;
      this.update({ status: 'stopped' });
    };
    this.startedAt = this.context.currentTime;
    this.source = source;
    source.start(0, this.offset);
    this.update({ status: 'playing', contextState: this.context.state });
  }

  async play() {
    if (
      (!this.state.buffer && !this.arrangement) ||
      this.state.status === 'playing'
    )
      return;
    const generation = ++this.generation;
    const context = await this.ensureContext();
    await context.resume();
    if (generation !== this.generation) return;
    if (context.state !== 'running')
      throw new Error(
        'Audio is interrupted. Press play again when your output is available.',
      );
    if (this.offset >= this.state.duration) this.offset = 0;
    this.startSource();
  }

  pause() {
    this.generation++;
    const position = this.position;
    this.disconnectSource();
    this.offset = position;
    this.update({
      status: this.state.buffer || this.arrangement ? 'paused' : 'stopped',
    });
  }

  stop() {
    this.generation++;
    this.disconnectSource();
    this.offset = 0;
    this.update({ status: 'stopped' });
  }

  seek(seconds: number) {
    if (!this.state.buffer && !this.arrangement) return;
    const playing = this.state.status === 'playing';
    this.generation++;
    this.disconnectSource();
    this.offset = Math.max(0, Math.min(this.state.duration, seconds));
    if (playing && this.offset < this.state.duration) this.startSource();
    else this.update({ status: playing ? 'stopped' : this.state.status });
  }

  setVolume(volume: number) {
    this.update({ volume: Math.max(-60, Math.min(6, volume)) });
    this.applyGain();
  }
  setMuted(muted: boolean) {
    this.update({ muted });
    this.applyGain();
  }
  private applyGain() {
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        this.state.muted ? 0 : dbToGain(this.state.volume),
        this.context.currentTime,
        0.008,
      );
  }

  async setDevice(deviceId: string) {
    const context = await this.ensureContext();
    if (!context.setSinkId) {
      if (deviceId)
        throw new Error(
          'Use your system sound settings to choose an output in this browser.',
        );
    } else await context.setSinkId(deviceId);
    this.update({
      deviceId,
      outputLatency: context.outputLatency ?? null,
      baseLatency: context.baseLatency ?? null,
    });
  }

  async configure(settings: AudioSettings) {
    // A rejected setting leaves the existing audio graph and playback intact.
    const replacement = await this.createContext(settings);
    const wasPlaying = this.state.status === 'playing';
    if (wasPlaying) {
      try {
        await replacement.resume();
      } catch (error) {
        await replacement.close();
        throw error;
      }
      if (replacement.state !== 'running') {
        await replacement.close();
        throw new Error('Audio settings could not be applied. Try again.');
      }
    }
    const old = this.context;
    const oldStatus = this.state.status;
    this.pause();
    if (old) old.onstatechange = null;
    this.master?.disconnect();
    this.splitter?.disconnect();
    this.analysers.forEach((analyser) => analyser.disconnect());
    this.attachContext(replacement);
    this.update({
      settings,
      status: oldStatus === 'playing' ? 'paused' : oldStatus,
    });
    if (old) await old.close();
    if (wasPlaying) await this.play();
  }

  readLevels(): [number, number] {
    if (this.state.status !== 'playing') return [0, 0];
    return this.analysers.map((analyser, index) => {
      const data = this.meterData[index];
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (const sample of data) peak = Math.max(peak, Math.abs(sample));
      return peak;
    }) as [number, number];
  }

  async dispose() {
    this.stop();
    if (this.context) {
      this.context.onstatechange = null;
      await this.context.close();
    }
    this.context = null;
    this.listeners.clear();
  }
}
