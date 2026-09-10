import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trimClip,
  clipPlayhead,
  seekClipBeat,
  moveNotes,
  resizeNotes,
  pasteNotes,
  notesInBox,
  splitClip,
} from '../lib/editing.ts';
import { ProjectSession } from '../lib/project-session.ts';
import {
  newTrack,
  parseProject,
  clipEndBeat,
  snapBeat,
  beatsToSeconds,
  type Clip,
} from '../lib/project.ts';
import { validateNotes, type MidiNote } from '../lib/midi.ts';
import { FakeContext, wavFile } from './audio-fixtures.ts';

beforeEach(() => {
  FakeContext.instances = [];
  FakeContext.rejectSampleRate = 0;
  FakeContext.rejectDecode = false;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
});
const chord = (): MidiNote[] => [
  { id: 'one', pitch: 60, start: 1, length: 1, velocity: 90 },
  { id: 'two', pitch: 64, start: 1.5, length: 2, velocity: 110 },
  { id: 'three', pitch: 67, start: 2, length: 0.5, velocity: 75 },
];
const audio = (): Clip => ({
  id: 'audio',
  assetId: 'source',
  name: 'Audio',
  startBeat: 4,
  offsetSeconds: 2,
  durationSeconds: 8,
});

void test('audio splits preserve total duration, source identity and contiguous offsets at the project tempo', () => {
  const original = audio();
  const before = structuredClone(original);
  const [left, right] = splitClip(original, 7, 90);
  assert.equal(left.id, original.id);
  assert.notEqual(right.id, left.id);
  assert.equal(left.durationSeconds, 2);
  assert.equal(right.durationSeconds, 6);
  assert.equal(right.offsetSeconds, 4);
  assert.equal(left.offsetSeconds, 2);
  assert.equal(right.startBeat, 7);
  assert.equal(clipEndBeat(left, 90), right.startBeat);
  assert.equal(clipEndBeat(right, 90), clipEndBeat(original, 90));
  assert.equal(left.assetId, right.assetId);
  assert.deepEqual(original, before);
});

void test('MIDI splitting divides crossing notes without zero-length notes and retains velocity', () => {
  const original: Clip = {
    ...audio(),
    kind: 'midi',
    assetId: '',
    offsetSeconds: 0,
    durationSeconds: 1,
    lengthBeats: 4,
    notes: chord(),
  };
  const [left, right] = splitClip(original, 6, 120);
  assert.deepEqual(
    left.notes!.map((n) => [n.start, n.length, n.velocity]),
    [
      [1, 1, 90],
      [1.5, 0.5, 110],
    ],
  );
  assert.deepEqual(
    right.notes!.map((n) => [n.start, n.length, n.velocity]),
    [
      [0, 1.5, 110],
      [0, 0.5, 75],
    ],
  );
  assert.equal(left.lengthBeats, 2);
  assert.equal(right.lengthBeats, 2);
  assert.equal(left.durationSeconds, 1);
  assert.equal(right.durationSeconds, 1);
  assert.ok(
    right.notes!.every((n) => !original.notes!.some((o) => n.id === o.id)),
  );
  assert.doesNotThrow(() => validateNotes(left.notes, 2));
  assert.doesNotThrow(() => validateNotes(right.notes, 2));
  assert.equal(original.notes![1].length, 2);
});

void test('invalid or edge splits leave session history and media unchanged', async () => {
  const session = new ProjectSession();
  const track = session.getSnapshot().project.tracks[0];
  const [id] = await session.importFiles(
    [new File([wavFile()], 'audio.wav')],
    track.id,
    4,
  );
  const before = session.getSnapshot();
  for (const beat of [4, 24, 0, NaN, Infinity])
    assert.throws(() => session.split(track.id, id, beat), /inside/);
  assert.equal(session.getSnapshot(), before);
  assert.equal(session.assets.size, 1);
});

void test('splitting is one undo step and survives project save/open with shared original audio', async () => {
  const session = new ProjectSession();
  const track = session.getSnapshot().project.tracks[0];
  const [id] = await session.importFiles(
    [new File([wavFile()], 'audio.wav')],
    track.id,
    0,
  );
  session.split(track.id, id, 8);
  const clips = session.getSnapshot().project.tracks[0].clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[1].offsetSeconds, 4);
  assert.equal(session.assets.size, 1);
  const restored = new ProjectSession();
  await restored.open(new File([session.serialize()], 'split.mnt'));
  assert.deepEqual(restored.getSnapshot().project.tracks[0].clips, clips);
  session.undo();
  assert.equal(session.getSnapshot().project.tracks[0].clips.length, 1);
  session.redo();
  assert.deepEqual(session.getSnapshot().project.tracks[0].clips, clips);
});

void test('marquee selection finds intersecting notes in either drag direction and excludes touching edges', () => {
  assert.deepEqual(notesInBox(chord(), 1.75, 2.25, 60, 64), ['one', 'two']);
  assert.deepEqual(notesInBox(chord(), 2.25, 1.75, 64, 60), ['one', 'two']);
  assert.deepEqual(notesInBox(chord(), 2, 2.25, 60, 60), []);
  assert.deepEqual(notesInBox(chord(), 0, 0.9, 0, 127), []);
});

void test('group moves clamp as a unit and keep note spacing, intervals, lengths and velocity', () => {
  const original = chord();
  const moved = moveNotes(original, -100, 100, 4);
  assert.deepEqual(
    moved.map((n) => n.start),
    [0, 0.5, 1],
  );
  assert.deepEqual(
    moved.map((n) => n.pitch),
    [120, 124, 127],
  );
  assert.deepEqual(
    moved.map((n) => [n.length, n.velocity]),
    original.map((n) => [n.length, n.velocity]),
  );
  const end = moveNotes(original, 100, -100, 4);
  assert.equal(Math.max(...end.map((n) => n.start + n.length)), 4);
  assert.deepEqual(
    end.map((n) => n.pitch),
    [0, 4, 7],
  );
  assert.equal(original[0].start, 1);
});

void test('group resizing preserves relative lengths within the shortest note and clip boundary', () => {
  const longer = resizeNotes(chord(), 10, 4, 0.25);
  assert.deepEqual(
    longer.map((n) => n.length),
    [1.5, 2.5, 1],
  );
  const shorter = resizeNotes(chord(), -10, 4, 0.25);
  assert.deepEqual(
    shorter.map((n) => n.length),
    [0.75, 1.75, 0.25],
  );
  assert.doesNotThrow(() => validateNotes(shorter, 4));
});

void test('group pasting creates independent notes with relative timing and clamps the entire group at clip edges', () => {
  const copied = chord();
  const pasted = pasteNotes(copied, 3.5, 4);
  assert.deepEqual(
    pasted.map((n) => n.start),
    [1.5, 2, 2.5],
  );
  assert.deepEqual(
    pasted.map((n) => [n.pitch, n.velocity, n.length]),
    copied.map((n) => [n.pitch, n.velocity, n.length]),
  );
  assert.ok(pasted.every((n) => !copied.some((o) => o.id === n.id)));
  assert.throws(() => pasteNotes(copied, 0, 2), /longer/);
  assert.deepEqual(pasteNotes([], 0, 4), []);
});

void test('note clipboard survives switching clips and stores an independent snapshot', () => {
  const session = new ProjectSession();
  const track = newTrack(2, 'midi');
  session.edit((p) => ({ ...p, tracks: [...p.tracks, track] }));
  const first = session.addMidiClip(track.id, 0),
    second = session.addMidiClip(track.id, 4);
  const copied = chord();
  session.copyNotes(copied);
  copied[0].pitch = 1;
  assert.equal(session.copiedNotes()[0].pitch, 60);
  const notes = pasteNotes(session.copiedNotes(), 0, 4);
  session.edit((p) => ({
    ...p,
    tracks: p.tracks.map((t) =>
      t.id === track.id
        ? {
            ...t,
            clips: t.clips.map((c) => (c.id === second ? { ...c, notes } : c)),
          }
        : t,
    ),
  }));
  assert.equal(
    session.getSnapshot().project.tracks[2].clips.find((c) => c.id === first)!
      .notes!.length,
    0,
  );
  assert.equal(
    session.getSnapshot().project.tracks[2].clips[1].notes!.length,
    3,
  );
  assert.doesNotThrow(() => parseProject(session.serialize()));
  session.reset();
  assert.deepEqual(session.copiedNotes(), []);
});

void test('playhead paste follows the live tempo map, snaps forward, and extends the clip in one undo step', async () => {
  const session = new ProjectSession();
  const track = newTrack(2, 'midi');
  session.edit((p) => ({
    ...p,
    tracks: [...p.tracks, track],
    tempoMarkers: [{ id: 'slow', beat: 4, tempo: 60 }],
  }));
  const id = session.addMidiClip(track.id, 4);
  session.copyNotes(chord());
  await session.play();
  FakeContext.instances[0].currentTime = 5.1; // Global beat 7.1, local beat 3.1.
  const ids = session.pasteNotesAtPlayhead(track.id, id, 0.25);
  const pasted = session.getSnapshot().project.tracks[2].clips[0];
  assert.deepEqual(
    pasted.notes!.map((n) => n.start),
    [3.25, 3.75, 4.25],
  );
  assert.deepEqual(
    pasted.notes!.map((n) => [n.pitch, n.velocity, n.length]),
    chord().map((n) => [n.pitch, n.velocity, n.length]),
  );
  assert.deepEqual(
    pasted.notes!.map((n) => n.id),
    ids,
  );
  assert.equal(pasted.lengthBeats, 5.75);
  assert.equal(session.engine.getSnapshot().status, 'playing');
  session.undo();
  assert.equal(session.getSnapshot().project.tracks[2].clips[0].lengthBeats, 4);
  assert.deepEqual(session.getSnapshot().project.tracks[2].clips[0].notes, []);
  session.redo();
  assert.deepEqual(session.getSnapshot().project.tracks[2].clips[0], pasted);
  assert.deepEqual(
    parseProject(session.serialize()).project.tracks[2].clips[0],
    pasted,
  );
});

void test('playhead paste respects free timing and triplets and never moves a phrase backward to fit', () => {
  const session = new ProjectSession();
  const track = newTrack(2, 'midi');
  session.edit((p) => ({ ...p, tracks: [...p.tracks, track] }));
  const id = session.addMidiClip(track.id, 4);
  session.copyNotes(chord());
  session.engine.seek(beatsToSeconds(2, 120));
  session.pasteNotesAtPlayhead(track.id, id, 0);
  assert.equal(
    session.getSnapshot().project.tracks[2].clips[0].notes![0].start,
    0,
  );
  session.engine.seek(beatsToSeconds(8.125, 120));
  const first = session.pasteNotesAtPlayhead(track.id, id, 0)[0];
  assert.equal(
    session
      .getSnapshot()
      .project.tracks[2].clips[0].notes!.find((n) => n.id === first)!.start,
    4.125,
  );
  const second = session.pasteNotesAtPlayhead(track.id, id, 1 / 3)[0];
  assert.ok(
    Math.abs(
      session
        .getSnapshot()
        .project.tracks[2].clips[0].notes!.find((n) => n.id === second)!.start -
        13 / 3,
    ) < 1e-9,
  );
  assert.deepEqual(session.copiedNotes(), chord());
});

void test('paste beyond the MIDI length limit leaves clip, playhead, clipboard and undo history intact', () => {
  const session = new ProjectSession();
  const track = newTrack(2, 'midi');
  session.edit((p) => ({
    ...p,
    tracks: [...p.tracks, track],
    tempoMarkers: [{ id: 'later', beat: 5000, tempo: 120 }],
  }));
  const id = session.addMidiClip(track.id, 0);
  session.copyNotes(chord());
  session.engine.seek(beatsToSeconds(4095, 120));
  const before = session.getSnapshot();
  assert.throws(() => session.pasteNotesAtPlayhead(track.id, id, 0.25), /4096/);
  assert.equal(session.getSnapshot(), before);
  assert.equal(session.engine.position, beatsToSeconds(4095, 120));
  assert.deepEqual(session.copiedNotes(), chord());
});

void test('audio left-edge trims keep the end fixed and can recover earlier source audio', () => {
  const original = audio();
  const shorter = trimClip(original, 'left', 6, 120, 10);
  assert.equal(shorter.startBeat, 6);
  assert.equal(shorter.offsetSeconds, 3);
  assert.equal(shorter.durationSeconds, 7);
  assert.equal(clipEndBeat(shorter, 120), clipEndBeat(original, 120));
  const extended = trimClip(shorter, 'left', -100, 120, 10);
  assert.equal(extended.startBeat, 0);
  assert.equal(extended.offsetSeconds, 0);
  assert.equal(extended.durationSeconds, 10);
  assert.equal(original.offsetSeconds, 2);
});

void test('both audio edges respect the source boundaries and project start', () => {
  const original = audio();
  assert.equal(trimClip(original, 'right', 9999, 120, 10).durationSeconds, 8);
  const shorter = trimClip(original, 'right', 6, 120, 10);
  assert.equal(shorter.durationSeconds, 1);
  assert.equal(trimClip(shorter, 'right', 9999, 120, 10).durationSeconds, 8);
  const atStart = trimClip(
    { ...original, startBeat: 1 },
    'left',
    -999,
    120,
    10,
  );
  assert.equal(atStart.startBeat, 0);
  assert.equal(atStart.offsetSeconds, 1.5);
  for (const side of ['left', 'right'] as const) {
    const result = trimClip(original, side, 999999, 120, 10);
    assert.ok(result.durationSeconds > 0);
    assert.ok(result.offsetSeconds >= 0);
    assert.ok(result.offsetSeconds + result.durationSeconds <= 10);
  }
  assert.throws(() => trimClip(original, 'right', 8, 120), /source/);
});

void test('sub-millisecond audio tails never extend beyond the source', () => {
  const result = trimClip(
    { ...audio(), offsetSeconds: 9.9995, durationSeconds: 0.001 },
    'right',
    100,
    120,
    10,
  );
  assert.ok(result.durationSeconds > 0);
  assert.ok(result.offsetSeconds + result.durationSeconds <= 10);
});

void test('MIDI trimming rebases crossing notes while extension preserves their absolute positions', () => {
  const original: Clip = {
    ...audio(),
    kind: 'midi',
    startBeat: 8,
    assetId: '',
    offsetSeconds: 0,
    durationSeconds: 1,
    lengthBeats: 4,
    notes: chord(),
  };
  const left = trimClip(original, 'left', 10, 120);
  assert.equal(left.lengthBeats, 2);
  assert.deepEqual(
    left.notes!.map((n) => [n.pitch, n.start, n.length]),
    [
      [64, 0, 1.5],
      [67, 0, 0.5],
    ],
  );
  const right = trimClip(original, 'right', 9.75, 120);
  assert.deepEqual(
    right.notes!.map((n) => [n.start, n.length]),
    [
      [1, 0.75],
      [1.5, 0.25],
    ],
  );
  const extended = trimClip(original, 'left', 6, 120);
  assert.equal(extended.lengthBeats, 6);
  assert.deepEqual(
    extended.notes!.map((n) => extended.startBeat + n.start),
    original.notes!.map((n) => original.startBeat + n.start),
  );
  assert.equal(trimClip(original, 'right', 1e6, 120).lengthBeats, 4096);
  assert.equal(trimClip(original, 'right', 0, 120).lengthBeats, 0.0625);
  for (const clip of [left, right, extended])
    assert.doesNotThrow(() => validateNotes(clip.notes, clip.lengthBeats!));
});

void test('trims survive save/open and undo restores the original source window', async () => {
  const session = new ProjectSession();
  const track = session.getSnapshot().project.tracks[0];
  const [id] = await session.importFiles(
    [new File([wavFile()], 'audio.wav')],
    track.id,
    4,
  );
  const original = session.getSnapshot().project.tracks[0].clips[0];
  const trimmed = trimClip(original, 'left', 8, 120, 10);
  session.edit((p) => ({
    ...p,
    tracks: p.tracks.map((t) =>
      t.id === track.id ? { ...t, clips: [trimmed] } : t,
    ),
  }));
  const reopened = new ProjectSession();
  await reopened.open(new File([session.serialize()], 'trim.mnt'));
  assert.equal(
    reopened.getSnapshot().project.tracks[0].clips[0].offsetSeconds,
    2,
  );
  assert.equal(reopened.getSnapshot().project.tracks[0].clips[0].id, id);
  session.undo();
  assert.deepEqual(session.getSnapshot().project.tracks[0].clips[0], original);
});

void test('straight and triplet snap divisions quantize beat positions, with exact free positioning when off', () => {
  assert.equal(snapBeat(2.37, true, 0.25), 2.25);
  assert.equal(snapBeat(2.38, true, 0.25), 2.5);
  assert.equal(snapBeat(0.36, true, 1 / 3), 1 / 3);
  assert.equal(snapBeat(0.36, false, 0.25), 0.36);
  assert.equal(snapBeat(0.36, true, 0), 0.36);
  assert.equal(snapBeat(-1, true, 0.25), 0);
});

void test('piano playheads use clip-local beats and seeking translates back to the project clock', () => {
  const clip: Clip = {
    ...audio(),
    kind: 'midi',
    startBeat: 40,
    lengthBeats: 8,
  };
  assert.equal(clipPlayhead(clip, 39), null);
  assert.equal(clipPlayhead(clip, 40), 0);
  assert.equal(clipPlayhead(clip, 42.5), 2.5);
  assert.equal(clipPlayhead(clip, 48), 8);
  assert.equal(clipPlayhead(clip, 49), null);
  assert.equal(seekClipBeat(clip, 0.38, 0.25), 40.5);
  assert.equal(seekClipBeat(clip, -2, 0.25), 40);
  assert.equal(seekClipBeat(clip, 100, 0.25), 48);
  assert.equal(seekClipBeat(clip, 0.38, 0), 40.38);
  assert.equal(beatsToSeconds(seekClipBeat(clip, 2, 0.25), 120), 21);
  assert.equal(beatsToSeconds(seekClipBeat(clip, 2, 0.25), 60), 42);
});
