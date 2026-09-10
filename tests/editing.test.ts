import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
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
