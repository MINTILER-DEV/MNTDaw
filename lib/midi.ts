export type MidiNote = {
  id: string;
  pitch: number;
  start: number;
  length: number;
  velocity: number;
};
export type Instrument = {
  type: 'synth' | 'soundfont' | 'vst3';
  parameters: Record<string, number>;
  waveform?: OscillatorType;
  soundfontId?: string;
  program?: number;
  bank?: number;
  pluginId?: string;
  pluginName?: string;
};
export const defaultInstrument = (): Instrument => ({
  type: 'synth',
  waveform: 'sawtooth',
  parameters: {
    attack: 0.012,
    decay: 0.18,
    sustain: 0.65,
    release: 0.25,
    cutoff: 5000,
    resonance: 1,
    detune: 0,
  },
});
export const noteName = (pitch: number) =>
  `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
export const midiFrequency = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
export function validateNotes(value: unknown, length: number): MidiNote[] {
  if (!Array.isArray(value) || value.length > 8192)
    throw new Error('Invalid MIDI note list (maximum 8192 notes per clip).');
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object')
      throw new Error('Invalid MIDI note.');
    const n = item as Record<string, unknown>;
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id))
      throw new Error('Invalid or duplicate MIDI note ID.');
    ids.add(n.id);
    for (const key of ['pitch', 'start', 'length', 'velocity'])
      if (typeof n[key] !== 'number' || !Number.isFinite(n[key]))
        throw new Error('Invalid MIDI note value.');
    const note = n as unknown as MidiNote;
    if (
      !Number.isInteger(note.pitch) ||
      note.pitch < 0 ||
      note.pitch > 127 ||
      !Number.isInteger(note.velocity) ||
      note.velocity < 1 ||
      note.velocity > 127 ||
      note.start < 0 ||
      note.length <= 0 ||
      note.start + note.length > length + 0.00001
    )
      throw new Error('MIDI note is outside the clip or MIDI range.');
    return {
      id: note.id,
      pitch: note.pitch,
      start: note.start,
      length: note.length,
      velocity: note.velocity,
    };
  });
}
export function validateInstrument(value: unknown): Instrument {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid instrument.');
  const v = value as Instrument;
  if (
    !['synth', 'soundfont', 'vst3'].includes(v.type) ||
    !v.parameters ||
    typeof v.parameters !== 'object' ||
    Array.isArray(v.parameters) ||
    Object.keys(v.parameters).length > 4096
  )
    throw new Error('Invalid instrument parameters.');
  const parameters: Record<string, number> = {};
  for (const [key, val] of Object.entries(v.parameters)) {
    if (
      key.length > 160 ||
      !Number.isFinite(val) ||
      Math.abs(val) > 100000 ||
      (v.type === 'vst3' && (val < 0 || val > 1))
    )
      throw new Error('Invalid plugin parameter.');
    Object.defineProperty(parameters, key, {
      value: val,
      enumerable: true,
      writable: true,
    });
  }
  if (
    v.waveform &&
    !['sine', 'triangle', 'square', 'sawtooth'].includes(v.waveform)
  )
    throw new Error('Invalid synth waveform.');
  if (
    v.type === 'soundfont' &&
    (typeof v.soundfontId !== 'string' || !v.soundfontId)
  )
    throw new Error('Missing SoundFont.');
  if (v.type === 'vst3' && (typeof v.pluginId !== 'string' || !v.pluginId))
    throw new Error('Missing VST3 instrument.');
  for (const value of [v.program, v.bank])
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 0 || value > 16383)
    )
      throw new Error('Invalid SoundFont preset.');
  return {
    type: v.type,
    parameters,
    ...(v.waveform ? { waveform: v.waveform } : {}),
    ...(v.soundfontId
      ? { soundfontId: String(v.soundfontId).slice(0, 160) }
      : {}),
    ...(v.program !== undefined ? { program: v.program } : {}),
    ...(v.bank !== undefined ? { bank: v.bank } : {}),
    ...(v.pluginId
      ? {
          pluginId: String(v.pluginId).slice(0, 160),
          pluginName: String(v.pluginName ?? 'VST3').slice(0, 160),
        }
      : {}),
  };
}
