import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beatsToSeconds,
  secondsToBeats,
  beatDuration,
  tempoAtBeat,
  rulerBeatAt,
} from '../lib/tempo-map.ts';
import {
  newProject,
  newTrack,
  serializeProject,
  parseProject,
  clipEndBeat,
  snapBeat,
  projectLength,
  type Clip,
} from '../lib/project.ts';
import { trimClip, splitClip, clipPlayhead } from '../lib/editing.ts';
import { ProjectSession } from '../lib/project-session.ts';
import { FakeContext, wavFile } from './audio-fixtures.ts';

const map = {
  tempo: 120,
  tempoMarkers: [
    { id: 'slow', beat: 4, tempo: 60 },
    { id: 'fast', beat: 8, tempo: 180 },
  ],
};
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

beforeEach(() => {
  FakeContext.instances = [];
  FakeContext.rejectSampleRate = 0;
  FakeContext.rejectDecode = false;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
});

void test('tempo boundaries, inverse conversion and sustained-note durations follow all segments', () => {
  assert.equal(beatsToSeconds(4, map), 2);
  assert.equal(beatsToSeconds(8, map), 6);
  assert.equal(beatsToSeconds(11, map), 7);
  assert.equal(tempoAtBeat(3.99, map), 120);
  assert.equal(tempoAtBeat(4, map), 60);
  assert.equal(tempoAtBeat(8, map), 180);
  assert.equal(beatDuration(3, 6, map), 0.5 + 4 + 1 / 3);
  near(beatDuration(9, -6, map), -(0.5 + 4 + 1 / 3));
  for (const beat of [0, 0.001, 3.99, 4, 4.001, 8, 11, 100000])
    near(secondsToBeats(beatsToSeconds(beat, map), map), beat);
  assert.equal(
    beatsToSeconds(4, {
      tempo: 120,
      tempoMarkers: [{ id: 'zero', beat: 0, tempo: 60 }],
    }),
    4,
  );
  assert.equal(
    beatsToSeconds(11, {
      ...map,
      tempoMarkers: [...map.tempoMarkers].reverse(),
    }),
    7,
  );
});

void test('tempo and signature changes at the same beat round-trip, with legacy files still unchanged', () => {
  const project = {
    ...newProject(),
    ...map,
    signatureMarkers: [
      { id: 'meter', beat: 4, signature: [3, 4] as [number, number] },
    ],
  };
  assert.deepEqual(
    parseProject(serializeProject(project, new Map())).project,
    project,
  );
  project.tempoMarkers = [{ id: 'distant', beat: 200, tempo: 90 }];
  assert.ok(projectLength(project) > 200);
  const legacy = newProject();
  assert.deepEqual(
    parseProject(serializeProject(legacy, new Map())).project,
    legacy,
  );
});

void test('invalid BPM markers, duplicate locations and oversized maps are rejected', () => {
  for (const tempoMarkers of [
    [{ id: 'bad', beat: 0, tempo: 0 }],
    [{ id: 'bad', beat: 0, tempo: 301 }],
    [{ id: 'bad', beat: -1, tempo: 120 }],
    [{ id: 'bad', beat: 100001, tempo: 120 }],
    [
      { id: 'same', beat: 1, tempo: 120 },
      { id: 'same', beat: 2, tempo: 90 },
    ],
    [
      { id: 'one', beat: 1, tempo: 120 },
      { id: 'two', beat: 1, tempo: 90 },
    ],
    Array.from({ length: 1025 }, (_, i) => ({
      id: String(i),
      beat: i,
      tempo: 120,
    })),
  ])
    assert.throws(() =>
      parseProject(JSON.stringify({ ...newProject(), tempoMarkers })),
    );
});

void test('audio split and both trims use source seconds across tempo changes without exceeding the file', () => {
  const clip: Clip = {
    id: 'clip',
    name: 'Audio',
    assetId: 'audio',
    startBeat: 2,
    offsetSeconds: 1,
    durationSeconds: 5,
  };
  assert.equal(clipEndBeat(clip, map), 8);
  const [left, right] = splitClip(clip, 5, map);
  assert.equal(left.durationSeconds, 2);
  assert.equal(right.offsetSeconds, 3);
  assert.equal(right.durationSeconds, 3);
  assert.equal(clipEndBeat(right, map), 8);
  const shorter = trimClip(clip, 'left', 5, map, 9);
  assert.equal(shorter.offsetSeconds, 3);
  assert.equal(clipEndBeat(shorter, map), 8);
  const extended = trimClip(shorter, 'left', -10, map, 9);
  assert.equal(extended.startBeat, 0);
  assert.equal(extended.offsetSeconds, 0);
  assert.equal(clipEndBeat(extended, map), 8);
  const max = trimClip(clip, 'right', 100, map, 9);
  assert.equal(max.durationSeconds + max.offsetSeconds, 9);
  assert.equal(clipEndBeat(max, map), 17);
});

void test('editing and deleting BPM changes preserve beat position with undo, redo and reopen', async () => {
  const session = new ProjectSession();
  session.edit((p) => ({ ...p }));
  session.engine.seek(3); // beat 6 at the initial 120 BPM
  session.edit((p) => ({ ...p, tempoMarkers: map.tempoMarkers }));
  assert.equal(session.engine.position, 4);
  assert.equal(session.getSnapshot().project.positionBeats, 6);
  session.undo();
  assert.equal(session.engine.position, 3);
  session.redo();
  assert.equal(session.engine.position, 4);
  const saved = session.serialize();
  session.edit((p) => ({ ...p, tempoMarkers: [] }));
  assert.equal(session.engine.position, 3);
  await session.open(new File([saved], 'Tempo.mnt'));
  assert.equal(session.engine.position, 4);
  assert.deepEqual(
    session.getSnapshot().project.tempoMarkers,
    map.tempoMarkers,
  );
});

void test('audio imports and duplication meet at source ends under a tempo map', async () => {
  const session = new ProjectSession();
  session.edit((p) => ({ ...p, tempoMarkers: map.tempoMarkers }));
  const id = session.getSnapshot().project.tracks[0].id;
  await session.importFiles(
    [new File([wavFile()], 'One.wav'), new File([wavFile()], 'Two.wav')],
    id,
    2,
  );
  let p = session.getSnapshot().project;
  near(p.tracks[0].clips[1].startBeat, 23);
  near(clipEndBeat(p.tracks[0].clips[0], p), 23);
  session.duplicate(id, p.tracks[0].clips[1].id);
  p = session.getSnapshot().project;
  near(p.tracks[0].clips[2].startBeat, 53);
  await session.play();
  const sources = FakeContext.instances[0].sources.filter(
    (source) => !source.stopped && source.duration !== undefined,
  );
  assert.deepEqual(
    sources.map((source) => source.when),
    [1, 11, 21],
  );
  assert.deepEqual(
    sources.map((source) => source.duration),
    [10, 10, 10],
  );
});

void test('synth note-off crosses a tempo marker and piano position follows the same clock', async () => {
  const session = new ProjectSession();
  const track = newTrack(2, 'midi');
  const clip: Clip = {
    id: 'midi',
    name: 'Held',
    kind: 'midi',
    assetId: '',
    startBeat: 2,
    lengthBeats: 8,
    offsetSeconds: 0,
    durationSeconds: 0,
    notes: [{ id: 'note', start: 1, length: 6, pitch: 69, velocity: 96 }],
  };
  track.clips = [clip];
  session.edit((p) => ({
    ...p,
    tempoMarkers: map.tempoMarkers,
    tracks: [...p.tracks, track],
  }));
  await session.play();
  const context = FakeContext.instances[0];
  near(context.oscillators[0].when, 1.5);
  // Default synth release is 0.25s plus the 0.01s stop margin.
  near(context.oscillators[0].stopAt, 6 + 1 / 3 + 0.26);
  context.currentTime = 4;
  assert.equal(
    clipPlayhead(clip, secondsToBeats(session.engine.position, map)),
    4,
  );
});

void test('hover and insertion coordinates account for horizontal scroll, zoom and straight/triplet/off snap', () => {
  const at = rulerBeatAt(410, -206, 64, 128);
  assert.equal(at, 9.625);
  assert.equal(snapBeat(at, true, 0.25), 9.75);
  near(snapBeat(at, true, 1 / 3), 29 / 3);
  assert.equal(snapBeat(at, false), 9.625);
  assert.equal(rulerBeatAt(0, 206, 64, 128), 0);
  assert.equal(rulerBeatAt(100000, 206, 64, 128), 128);
});
