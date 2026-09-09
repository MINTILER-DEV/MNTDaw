import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, type PlaybackTrack } from '../lib/audio-engine.ts';
import { ProjectSession } from '../lib/project-session.ts';
import {
  beatsToSeconds,
  secondsToBeats,
  musicalPosition,
  newProject,
  parseProject,
  serializeProject,
  projectLength,
  type Project,
} from '../lib/project.ts';
import { dbToGain } from '../lib/audio-utils.ts';
import { FakeContext, wavFile } from './audio-fixtures.ts';

beforeEach(() => {
  FakeContext.instances = [];
  FakeContext.rejectSampleRate = 0;
  FakeContext.rejectDecode = false;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
});

function populated() {
  const project = newProject();
  project.name = 'Night room — 夜';
  project.tempo = 98.5;
  project.assets = [{ id: 'wav-1', name: 'Texture.wav' }];
  project.tracks[0].clips = [
    {
      id: 'clip-1',
      assetId: 'wav-1',
      name: 'Texture',
      startBeat: 8,
      offsetSeconds: 0.25,
      durationSeconds: 2,
    },
  ];
  return project;
}
function json(project = populated()) {
  return serializeProject(project, new Map([['wav-1', wavFile()]]));
}
function mutate(
  change: (
    project: Project & { assets: { id: string; name: string; data: string }[] },
  ) => void,
) {
  const project = JSON.parse(json()) as Project & {
    assets: { id: string; name: string; data: string }[];
  };
  change(project);
  return JSON.stringify(project);
}

void test('empty project saves and reopens with a 16-bar timeline', () => {
  const project = newProject();
  const decoded = parseProject(serializeProject(project, new Map()));
  assert.deepEqual(decoded.project, project);
  assert.equal(projectLength(project), 64);
  assert.equal(decoded.audio.size, 0);
});
void test('project round-trip preserves Unicode, clip offsets, tempo, and exact WAV bytes', () => {
  const project = populated();
  project.positionBeats = 9.125;
  project.tracks[0].muted = true;
  project.tracks[1].solo = true;
  const decoded = parseProject(json(project));
  assert.deepEqual(decoded.project, project);
  assert.deepEqual(
    new Uint8Array(decoded.audio.get('wav-1')!),
    new Uint8Array(wavFile()),
  );
});
void test('project decoder rejects unknown versions, missing media, duplicate IDs, and invalid timing', () => {
  assert.throws(() => parseProject('{'), /readable/);
  assert.throws(
    () => parseProject(json().replace('"version":1', '"version":2')),
    /version/,
  );
  assert.throws(
    () =>
      parseProject(
        mutate((p) => {
          p.tracks[0].clips[0].assetId = 'missing';
        }),
      ),
    /missing audio/,
  );
  assert.throws(
    () =>
      parseProject(
        mutate((p) => {
          p.tracks[1].id = p.tracks[0].id;
        }),
      ),
    /Duplicate track/,
  );
  assert.throws(
    () =>
      parseProject(
        mutate((p) => {
          p.tracks[1].clips = [...p.tracks[0].clips];
        }),
      ),
    /Duplicate clip/,
  );
  assert.throws(
    () =>
      parseProject(
        mutate((p) => {
          p.tempo = 0;
        }),
      ),
    /tempo/,
  );
  assert.throws(
    () =>
      parseProject(
        mutate((p) => {
          p.tracks[0].clips[0].durationSeconds = -1;
        }),
      ),
    /duration/,
  );
  assert.throws(
    () =>
      parseProject(
        mutate((p) => {
          p.positionBeats = 999999;
        }),
      ),
    /playhead/,
  );
});
void test('invalid embedded audio and missing bytes fail explicitly', () => {
  assert.throws(
    () =>
      parseProject(
        mutate((p) => {
          p.assets[0].data = '!!!!';
        }),
      ),
    /embedded audio/,
  );
  assert.throws(
    () =>
      parseProject(
        mutate((p) => {
          p.assets[0].data = 'AAAA';
        }),
      ),
    /RIFF/,
  );
  assert.throws(
    () => serializeProject(populated(), new Map()),
    /Missing audio/,
  );
});
void test('embedded WAV validation handles large base64 data without regex stack overflow', () => {
  const bytes = new Uint8Array(1024 * 1024 + 44);
  bytes.set(new Uint8Array(wavFile()).subarray(0, 44));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.byteLength - 8, true);
  view.setUint32(40, bytes.byteLength - 44, true);
  const restored = parseProject(
    serializeProject(populated(), new Map([['wav-1', bytes.buffer]])),
  );
  assert.equal(restored.audio.get('wav-1')!.byteLength, bytes.byteLength);
});
void test('musical position and tempo conversion agree at bar and beat boundaries', () => {
  assert.equal(musicalPosition(0), '001.1.000');
  assert.equal(musicalPosition(4), '002.1.000');
  assert.equal(musicalPosition(9.5), '003.2.480');
  assert.equal(beatsToSeconds(8, 120), 4);
  assert.equal(secondsToBeats(4, 60), 4);
});

void test('importing multiple WAVs into one track places clips sequentially and is one undo step', async () => {
  const session = new ProjectSession();
  const trackId = session.getSnapshot().project.tracks[0].id;
  await session.importFiles(
    [new File([wavFile()], 'One.wav'), new File([wavFile()], 'Two.wav')],
    trackId,
    4,
  );
  const clips = session.getSnapshot().project.tracks[0].clips;
  assert.deepEqual(
    clips.map((clip) => clip.startBeat),
    [4, 24],
  );
  assert.equal(session.getSnapshot().project.assets.length, 2);
  session.undo();
  assert.equal(session.getSnapshot().project.assets.length, 0);
  assert.equal(session.getSnapshot().project.tracks[0].clips.length, 0);
  session.redo();
  assert.equal(session.getSnapshot().project.tracks[0].clips.length, 2);
});
void test('imports onto new tracks share the requested position', async () => {
  const session = new ProjectSession();
  await session.importFiles(
    [new File([wavFile()], 'One.wav'), new File([wavFile()], 'Two.wav')],
    null,
    8,
  );
  const tracks = session.getSnapshot().project.tracks;
  assert.equal(tracks.length, 4);
  assert.equal(tracks[2].clips[0].startBeat, 8);
  assert.equal(tracks[3].clips[0].startBeat, 8);
});
void test('session save/open restores mixer, clip placement, embedded files, and paused position', async () => {
  const original = new ProjectSession();
  await original.importFiles(
    [new File([wavFile()], 'Texture.wav')],
    original.getSnapshot().project.tracks[0].id,
    8,
  );
  original.edit((project) => ({
    ...project,
    name: 'Evening',
    tempo: 90,
    master: { volume: -12, muted: true },
    tracks: project.tracks.map((track, i) =>
      i === 0
        ? {
            ...track,
            solo: true,
            volume: -3,
            clips: track.clips.map((clip) => ({
              ...clip,
              offsetSeconds: 2,
              durationSeconds: 4,
            })),
          }
        : track,
    ),
  }));
  original.engine.seek(6);
  const reopened = new ProjectSession();
  await reopened.open(new File([original.serialize()], 'Evening.mnt'));
  const project = reopened.getSnapshot().project;
  assert.equal(project.name, 'Evening');
  assert.equal(project.tempo, 90);
  assert.deepEqual(project.master, { volume: -12, muted: true });
  assert.equal(project.tracks[0].solo, true);
  assert.equal(project.tracks[0].clips[0].offsetSeconds, 2);
  assert.equal(reopened.engine.position, 6);
  assert.equal(reopened.engine.getSnapshot().status, 'stopped');
  assert.equal(reopened.getSnapshot().dirty, false);
  assert.equal(reopened.assets.size, 1);
  assert.deepEqual(
    new Uint8Array([...reopened.assets.values()][0].bytes),
    new Uint8Array(wavFile()),
  );
});
void test('failed project opens are transactional even while audio is playing', async () => {
  const session = new ProjectSession();
  await session.importFiles([new File([wavFile()], 'Keep.wav')], null, 0);
  await session.engine.play();
  const before = session.getSnapshot().project;
  await assert.rejects(session.open(new File(['{}'], 'Broken.mnt')), /format/);
  assert.equal(session.getSnapshot().project, before);
  assert.equal(session.engine.getSnapshot().status, 'playing');
  await assert.rejects(
    session.open(
      new File(
        [
          mutate((p) => {
            p.tracks[0].clips[0].offsetSeconds = 9;
            p.tracks[0].clips[0].durationSeconds = 4;
          }),
        ],
        'Trim.mnt',
      ),
    ),
    /beyond/,
  );
  assert.equal(session.getSnapshot().project, before);
  assert.equal(session.engine.getSnapshot().status, 'playing');
});
void test('a failed multi-file import leaves the project and asset registry unchanged', async () => {
  const session = new ProjectSession();
  const before = session.getSnapshot().project;
  await assert.rejects(
    session.importFiles(
      [new File([wavFile()], 'Good.wav'), new File(['broken'], 'Bad.wav')],
      null,
      0,
    ),
  );
  assert.equal(session.getSnapshot().project, before);
  assert.equal(session.assets.size, 0);
});
void test('changing tempo preserves the musical cursor and clip durations', async () => {
  const session = new ProjectSession();
  await session.importFiles([new File([wavFile()], 'Beat.wav')], null, 8);
  await session.engine.play();
  FakeContext.instances[0].currentTime = 2;
  session.edit((project) => ({ ...project, tempo: 60 }));
  assert.equal(session.engine.position, 4);
  assert.equal(
    session.getSnapshot().project.tracks[2].clips[0].durationSeconds,
    10,
  );
  assert.equal(session.getSnapshot().project.tracks[2].clips[0].startBeat, 8);
  assert.equal(session.engine.getSnapshot().status, 'playing');
});
void test('undo and redo restore deleted clips without losing their audio', async () => {
  const session = new ProjectSession();
  await session.importFiles([new File([wavFile()], 'Beat.wav')], null, 0);
  const track = session.getSnapshot().project.tracks[2];
  const assetId = track.clips[0].assetId;
  session.edit((project) => ({
    ...project,
    tracks: project.tracks.filter((item) => item.id !== track.id),
  }));
  session.undo();
  assert.equal(
    session.getSnapshot().project.tracks[2].clips[0].assetId,
    assetId,
  );
  assert.ok(session.assets.has(assetId));
  session.redo();
  assert.equal(session.getSnapshot().project.tracks.length, 2);
});

function playbackTracks(): PlaybackTrack[] {
  const buffer = { duration: 10 } as AudioBuffer;
  return [
    {
      id: 'a',
      volume: -3,
      muted: false,
      solo: false,
      clips: [
        { buffer, start: 0, offset: 1, duration: 4 },
        { buffer, start: 6, offset: 0, duration: 2 },
      ],
    },
    {
      id: 'b',
      volume: -6,
      muted: false,
      solo: true,
      clips: [{ buffer, start: 2, offset: 0, duration: 5 }],
    },
  ];
}
void test('multitrack scheduler uses one audio-clock origin and honors solo routing', async () => {
  const engine = new AudioEngine();
  engine.setArrangement(playbackTracks(), 12);
  await engine.play();
  const context = FakeContext.instances[0];
  assert.deepEqual(
    context.sources.map((source) => [
      source.when,
      source.offset,
      source.duration,
    ]),
    [
      [0, 1, 4],
      [6, 0, 2],
      [2, 0, 5],
      [12, 0, undefined],
    ],
  );
  assert.equal(context.gains[1].gain.value, 0);
  assert.equal(context.gains[2].gain.value, dbToGain(-6));
  context.currentTime = 12;
  context.sources.at(-1)!.onended!();
  assert.equal(engine.getSnapshot().status, 'stopped');
  assert.equal(engine.position, 12);
});
void test('seeking into overlaps trims source offsets and keeps future clips scheduled', async () => {
  const engine = new AudioEngine();
  engine.setArrangement(playbackTracks(), 12);
  await engine.play();
  engine.seek(3);
  const context = FakeContext.instances[0];
  const sources = context.sources.slice(4);
  assert.deepEqual(
    sources.map((source) => [source.when, source.offset, source.duration]),
    [
      [0, 4, 1],
      [3, 0, 2],
      [0, 1, 4],
      [9, 0, undefined],
    ],
  );
  assert.ok(context.sources.slice(0, 4).every((source) => source.stopped));
  engine.pause();
  assert.equal(engine.position, 3);
});
void test('silent gaps and empty arrangements still advance to a deterministic end', async () => {
  const engine = new AudioEngine();
  engine.setArrangement([], 32);
  await engine.play();
  const context = FakeContext.instances[0];
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].when, 32);
  context.currentTime = 8;
  assert.equal(engine.position, 8);
  engine.stop();
  assert.equal(engine.position, 0);
});
void test('audio context replacement preserves the multitrack schedule and position', async () => {
  const engine = new AudioEngine();
  engine.setArrangement(playbackTracks(), 12);
  await engine.play();
  FakeContext.instances[0].currentTime = 3;
  await engine.configure({ sampleRate: 44100, bufferSize: 256 });
  assert.equal(engine.position, 3);
  assert.equal(engine.getSnapshot().status, 'playing');
  assert.equal(FakeContext.instances[1].sources.length, 4);
  assert.equal(FakeContext.instances[1].sources.at(-1)!.when, 9);
});
