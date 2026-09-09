import { type Instrument, midiFrequency } from './midi.ts';
const bounded = (
  v: number | undefined,
  fallback: number,
  min: number,
  max: number,
) => Math.max(min, Math.min(max, Number.isFinite(v) ? v! : fallback));
export function synthVoice(
  context: AudioContext,
  output: AudioNode,
  instrument: Instrument,
  pitch: number,
  velocity: number,
  when = context.currentTime,
  duration?: number,
) {
  const p = instrument.parameters;
  const attack = bounded(p.attack, 0.012, 0.002, 5),
    decay = bounded(p.decay, 0.18, 0.002, 5),
    sustain = bounded(p.sustain, 0.65, 0, 1),
    release = bounded(p.release, 0.25, 0.01, 8);
  const oscillator = context.createOscillator();
  oscillator.type = instrument.waveform ?? 'sawtooth';
  oscillator.frequency.value = midiFrequency(pitch);
  oscillator.detune.value = bounded(p.detune, 0, -1200, 1200);
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = bounded(p.cutoff, 5000, 40, 20000);
  filter.Q.value = bounded(p.resonance, 1, 0, 20);
  const gain = context.createGain();
  const level = (Math.max(0, Math.min(127, velocity)) / 127) * 0.18;
  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(output);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(level, when + attack);
  gain.gain.linearRampToValueAtTime(level * sustain, when + attack + decay);
  let stopped = false;
  const stop = (at = context.currentTime, force = false) => {
    if (stopped) return;
    stopped = true;
    const end = Math.max(at, when);
    const elapsed = end - when;
    const envelope =
      elapsed < attack
        ? (level * elapsed) / attack
        : elapsed < attack + decay
          ? level + ((level * sustain - level) * (elapsed - attack)) / decay
          : level * sustain;
    gain.gain.cancelScheduledValues(end);
    gain.gain.setValueAtTime(Math.max(0, envelope), end);
    gain.gain.linearRampToValueAtTime(0, end + (force ? 0.005 : release));
    oscillator.stop(end + (force ? 0.01 : release + 0.01));
  };
  oscillator.onended = () => {
    oscillator.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  oscillator.start(when);
  if (duration !== undefined) {
    const end = when + duration;
    const elapsed = duration;
    const envelope =
      elapsed < attack
        ? (level * elapsed) / attack
        : elapsed < attack + decay
          ? level + ((level * sustain - level) * (elapsed - attack)) / decay
          : level * sustain;
    gain.gain.cancelScheduledValues(end);
    gain.gain.setValueAtTime(Math.max(0, envelope), end);
    gain.gain.linearRampToValueAtTime(0, end + release);
    oscillator.stop(end + release + 0.01);
  }
  return () => stop(context.currentTime, duration !== undefined);
}
