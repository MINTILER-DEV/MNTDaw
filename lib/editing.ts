import type { MidiNote } from './midi.ts';
import { beatsToSeconds, clipEndBeat, type Clip } from './project.ts';

export function splitClip(
  clip: Clip,
  beat: number,
  tempo: number,
): [Clip, Clip] {
  const end = clipEndBeat(clip, tempo);
  const minimum = clip.kind === 'midi' ? 0.0625 : 1e-6;
  if (
    !Number.isFinite(beat) ||
    beat - clip.startBeat < minimum ||
    end - beat < minimum
  )
    throw new Error('Place the split inside the clip, away from its edges.');
  if (beat > 100000)
    throw new Error('The split is beyond the supported timeline.');
  const left = { ...clip };
  const right = { ...clip, id: crypto.randomUUID(), startBeat: beat };
  const local = beat - clip.startBeat;
  if (clip.kind === 'midi') {
    left.lengthBeats = local;
    right.lengthBeats = (clip.lengthBeats ?? 4) - local;
    left.notes = (clip.notes ?? [])
      .filter((n) => n.start < local)
      .map((n) => ({ ...n, length: Math.min(n.length, local - n.start) }));
    right.notes = (clip.notes ?? [])
      .filter((n) => n.start + n.length > local)
      .map((n) => ({
        ...n,
        id: crypto.randomUUID(),
        start: Math.max(0, n.start - local),
        length: n.start + n.length - Math.max(local, n.start),
      }));
  } else {
    const seconds = beatsToSeconds(local, tempo);
    left.durationSeconds = seconds;
    right.offsetSeconds = clip.offsetSeconds + seconds;
    right.durationSeconds = clip.durationSeconds - seconds;
  }
  return [left, right];
}

export function moveNotes(
  notes: MidiNote[],
  beats: number,
  pitches: number,
  clipLength: number,
) {
  if (!notes.length) return [];
  const start = Math.min(...notes.map((n) => n.start));
  const end = Math.max(...notes.map((n) => n.start + n.length));
  const low = Math.min(...notes.map((n) => n.pitch)),
    high = Math.max(...notes.map((n) => n.pitch));
  const dx = Math.max(-start, Math.min(clipLength - end, beats));
  const dy = Math.max(-low, Math.min(127 - high, Math.round(pitches)));
  return notes.map((n) => ({ ...n, start: n.start + dx, pitch: n.pitch + dy }));
}

export function resizeNotes(
  notes: MidiNote[],
  delta: number,
  clipLength: number,
  minimum: number,
) {
  if (!notes.length) return [];
  const lower = Math.max(
    ...notes.map((n) => Math.min(minimum, n.length) - n.length),
  );
  const upper = Math.min(...notes.map((n) => clipLength - n.start - n.length));
  const change = Math.max(lower, Math.min(upper, delta));
  return notes.map((n) => ({ ...n, length: n.length + change }));
}

export function pasteNotes(
  notes: MidiNote[],
  beat: number,
  clipLength: number,
) {
  if (!notes.length) return [];
  const first = Math.min(...notes.map((n) => n.start));
  const span = Math.max(...notes.map((n) => n.start + n.length)) - first;
  if (span > clipLength + 1e-9)
    throw new Error(
      'The copied notes are longer than this clip. Extend the clip first.',
    );
  const at = Math.max(0, Math.min(clipLength - span, beat));
  return notes.map((n) => ({
    ...n,
    id: crypto.randomUUID(),
    start: at + n.start - first,
  }));
}

export function notesInBox(
  notes: MidiNote[],
  fromBeat: number,
  toBeat: number,
  lowPitch: number,
  highPitch: number,
) {
  const left = Math.min(fromBeat, toBeat),
    right = Math.max(fromBeat, toBeat);
  const low = Math.min(lowPitch, highPitch),
    high = Math.max(lowPitch, highPitch);
  return notes
    .filter(
      (n) =>
        n.start < right &&
        n.start + n.length > left &&
        n.pitch >= low &&
        n.pitch <= high,
    )
    .map((n) => n.id);
}
