import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultInstrument,
  midiFrequency,
  noteName,
  validateInstrument,
  validateNotes,
  type MidiNote,
} from '../lib/midi.ts';
import {
  newProject,
  newTrack,
  parseProject,
  serializeProject,
  projectLength,
  type Clip,
} from '../lib/project.ts';
import {
  signatureBars,
  signaturePosition,
  validateSignature,
} from '../lib/time-signatures.ts';
import { ProjectSession } from '../lib/project-session.ts';
import { synthVoice } from '../lib/synth.ts';
import { FakeContext, wavFile } from './audio-fixtures.ts';
import { dbToGain } from '../lib/audio-utils.ts';
import { sineSoundfont } from './soundfont-fixture.ts';

beforeEach(() => {
  FakeContext.instances = [];
  FakeContext.rejectSampleRate = 0;
  FakeContext.rejectDecode = false;
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
});
const note = (): MidiNote => ({
  id: 'note',
  pitch: 69,
  start: 1,
  length: 2,
  velocity: 96,
});
function midiProject() {
  const project = newProject();
  const track = newTrack(2, 'midi');
  track.height = 180;
  track.clips = [
    {
      id: 'phrase',
      name: 'Phrase',
      kind: 'midi',
      assetId: '',
      startBeat: 4,
      offsetSeconds: 0,
      durationSeconds: 1,
      lengthBeats: 8,
      notes: [note()],
    },
  ];
  project.tracks.push(track);
  project.timeSignature = [3, 4];
  project.signatureMarkers = [{ id: 'seven', beat: 6, signature: [7, 8] }];
  return project;
}
void test('v2 round-trip preserves MIDI notes, velocity, instrument settings, height and signature markers', () => {
  const project = midiProject();
  assert.deepEqual(
    parseProject(serializeProject(project, new Map())).project,
    project,
  );
});
void test('legacy v1 audio projects still open', () => {
  const project = newProject();
  project.version = 1;
  assert.deepEqual(
    parseProject(serializeProject(project, new Map())).project,
    project,
  );
});

void test('saving a legacy session upgrades the project file to v2', async () => {
  const project = newProject();
  project.version = 1;
  const session = new ProjectSession();
  await session.open(
    new File([serializeProject(project, new Map())], 'legacy.mnt'),
  );
  assert.equal(parseProject(session.serialize()).project.version, 2);
});
void test('MIDI validation rejects impossible pitches, velocities, duplicate IDs and notes outside a clip', () => {
  for (const patch of [
    { pitch: 128 },
    { pitch: 60.5 },
    { velocity: 0 },
    { velocity: 128 },
    { velocity: NaN },
    { length: 0 },
    { start: -1 },
    { start: 7 },
  ])
    assert.throws(() => validateNotes([{ ...note(), ...patch }], 8), /MIDI/);
  assert.throws(() => validateNotes([note(), note()], 8), /duplicate/);
  assert.equal(midiFrequency(69), 440);
  assert.equal(noteName(60), 'C4');
});
void test('MIDI and audio clips cannot be saved onto the wrong track kind', () => {
  const p = midiProject();
  p.tracks[0].clips = p.tracks[2].clips;
  p.tracks[2].clips = [];
  assert.throws(
    () => parseProject(serializeProject(p, new Map())),
    /instrument track/,
  );
});
void test('SoundFont references must resolve and VST3 parameter values must be normalized', () => {
  const p = midiProject();
  p.tracks[2].instrument = {
    type: 'soundfont',
    soundfontId: 'absent',
    parameters: {},
  };
  assert.throws(
    () => parseProject(serializeProject(p, new Map())),
    /SoundFont/,
  );
  assert.throws(
    () =>
      validateInstrument({
        type: 'vst3',
        pluginId: 'test',
        parameters: { cutoff: 1.1 },
      }),
    /parameter/,
  );
  const plugin = {
    type: 'vst3' as const,
    pluginId: 'local',
    pluginName: 'Test instrument',
    parameters: { cutoff: 0.73, volume: 0 },
  };
  p.tracks[2].instrument = plugin;
  assert.deepEqual(
    parseProject(serializeProject(p, new Map())).project.tracks[2].instrument,
    plugin,
  );
});
void test('signature changes number bars correctly, including truncated bars and eighth-note beats', () => {
  const markers = [
    { id: 'seven', beat: 6, signature: [7, 8] as [number, number] },
    { id: 'four', beat: 10, signature: [4, 4] as [number, number] },
  ];
  assert.deepEqual(
    signatureBars([3, 4], markers, 14).map((b) => b.beat),
    [0, 3, 6, 9.5, 10, 14],
  );
  assert.equal(signaturePosition(6, [3, 4], markers), '003.1.000');
  assert.equal(signaturePosition(6.75, [3, 4], markers), '003.2.480');
  assert.equal(signaturePosition(10, [3, 4], markers), '005.1.000');
  assert.equal(signaturePosition(100000, [1, 32]), '800001.1.000');
  assert.throws(() => validateSignature([4, 3]), /signature/);
  const p = newProject();
  p.signatureMarkers = [{ id: 'later', beat: 200, signature: [5, 4] }];
  assert.ok(projectLength(p) > 200);
});
void test('duplicate and cut/paste produce independent note IDs and preserve the clipboard', async () => {
  const session = new ProjectSession();
  const p = midiProject();
  await session.open(new File([serializeProject(p, new Map())], 'midi.mnt'));
  const track = session.getSnapshot().project.tracks[2];
  session.copy(track.id, track.clips[0].id);
  session.duplicate(track.id);
  const copy = session.getSnapshot().project.tracks[3];
  assert.notEqual(copy.clips[0].id, track.clips[0].id);
  assert.notEqual(copy.clips[0].notes![0].id, track.clips[0].notes![0].id);
  session.paste(track.id, 16);
  assert.equal(session.getSnapshot().project.tracks[2].clips[1].startBeat, 16);
  assert.equal(session.getSnapshot().project.tracks.length, 4);
  session.copy(track.id, track.clips[0].id, true);
  assert.equal(session.getSnapshot().project.tracks[2].clips.length, 1);
  assert.throws(() => session.paste(p.tracks[0].id, 0), /instrument track/);
  session.paste(track.id, 20);
  session.undo();
  assert.equal(session.getSnapshot().project.tracks[2].clips.length, 1);
  session.undo();
  assert.equal(session.getSnapshot().project.tracks[2].clips.length, 2);
});
void test('MIDI scheduler uses tempo, pitch and velocity, trims on seek, and cancels on stop', async () => {
  const session = new ProjectSession();
  const p = midiProject();
  p.tempo = 120;
  p.tracks[2].volume = -9;
  await session.open(new File([serializeProject(p, new Map())], 'midi.mnt'));
  await session.play();
  const context = FakeContext.instances[0];
  assert.equal(context.oscillators[0].when, 2.5);
  assert.equal(context.oscillators[0].frequency.value, 440);
  assert.equal(context.oscillators[0].stopAt, 3.76);
  assert.ok(context.gains.some((g) => g.gain.value === dbToGain(-9)));
  const envelope = context.gains.find((g) =>
    g.gain.events.some(
      (e) => e.type === 'ramp' && e.value === (96 / 127) * 0.18,
    ),
  );
  assert.ok(envelope);
  session.engine.seek(3);
  assert.equal(context.oscillators[1].when, 0);
  assert.equal(context.oscillators[1].stopAt, 0.76);
  session.engine.stop();
  assert.equal(context.oscillators[1].stopAt, 0.01);
  assert.equal(session.engine.position, 0);
});
void test('short synth notes ramp during attack instead of remaining silent until note-off', () => {
  const context = new FakeContext({ sampleRate: 48000 });
  synthVoice(
    context as unknown as AudioContext,
    context.destination as unknown as AudioNode,
    {
      ...defaultInstrument(),
      parameters: { attack: 1, decay: 1, sustain: 0.5, release: 0.2 },
    },
    60,
    127,
    0,
    0.1,
  );
  const events = context.gains[0].gain.events;
  assert.ok(
    events.some(
      (e) =>
        e.type === 'ramp' &&
        e.time === 0.1 &&
        Math.abs(e.value! - 0.018) < 1e-9,
    ),
  );
  assert.ok(
    events.some((e) => e.type === 'ramp' && e.time > 0.1 && e.value === 0),
  );
});
void test('simultaneous live notes share one context and panic releases them', async () => {
  const session = new ProjectSession();
  const track = newTrack(2, 'midi');
  session.edit((p) => ({ ...p, tracks: [...p.tracks, track] }));
  await Promise.all([
    session.preview(track.id, 60, 100),
    session.preview(track.id, 64, 100),
    session.preview(track.id, 67, 100),
  ]);
  assert.equal(FakeContext.instances.length, 1);
  const context = FakeContext.instances[0];
  assert.equal(context.oscillators.length, 3);
  session.engine.panic();
  assert.ok(context.oscillators.every((o) => Number.isFinite(o.stopAt)));
});
void test('audio clipboard still shares original bytes and cannot paste onto an instrument track', async () => {
  const session = new ProjectSession();
  const track = newTrack(2, 'midi');
  session.edit((p) => ({ ...p, tracks: [...p.tracks, track] }));
  const audioTrack = session.getSnapshot().project.tracks[0];
  const [id] = await session.importFiles(
    [new File([wavFile()], 'Audio.wav')],
    audioTrack.id,
    0,
  );
  session.copy(audioTrack.id, id);
  assert.throws(() => session.paste(track.id, 0), /audio track/);
  session.paste(audioTrack.id, 12);
  assert.equal(session.assets.size, 1);
  assert.equal(session.getSnapshot().project.tracks[0].clips.length, 2);
});
void test('MIDI file import retains note timing and dynamics at the project tempo', async () => {
  const midiModule = await import('@tonejs/midi');
  const Midi =
    midiModule.Midi ??
    (midiModule as unknown as { default: { Midi: typeof midiModule.Midi } })
      .default.Midi;
  const midi = new Midi();
  midi.header.setTempo(85);
  midi
    .addTrack()
    .addNote({ midi: 65, ticks: 480, durationTicks: 240, velocity: 64 / 127 });
  const session = new ProjectSession();
  await session.importMidi(
    new File([Uint8Array.from(midi.toArray())], 'phrase.mid'),
    8,
  );
  const clip: Clip = session.getSnapshot().project.tracks[2].clips[0];
  assert.equal(clip.startBeat, 8);
  assert.equal(clip.notes![0].start, 1);
  assert.equal(clip.notes![0].length, 0.5);
  assert.equal(clip.notes![0].velocity, 64);
  assert.equal(session.getSnapshot().project.tempo, 120);
  assert.doesNotThrow(() => parseProject(session.serialize()));
});

void test('real generated SF2 preset loads, embeds exact bytes and reopens transactionally', async () => {
  const session = new ProjectSession();
  const track = newTrack(2, 'midi');
  session.edit((p) => ({ ...p, tracks: [...p.tracks, track] }));
  const bytes = sineSoundfont();
  await session.loadSoundfont(track.id, new File([bytes], 'Sine.sf2'));
  const instrument = session.getSnapshot().project.tracks[2].instrument!;
  assert.equal(instrument.type, 'soundfont');
  assert.deepEqual(session.presets.get(instrument.soundfontId!), [
    { name: 'Sine', program: 0, bank: 0 },
  ]);
  session.addMidiClip(track.id, 0);
  const reopened = new ProjectSession();
  await reopened.open(new File([session.serialize()], 'bank.mnt'));
  assert.deepEqual(reopened.soundfonts.get(instrument.soundfontId!), bytes);
  const previous = reopened.getSnapshot().project;
  await assert.rejects(
    reopened.loadSoundfont(track.id, new File(['bad'], 'Bad.sf2')),
  );
  assert.equal(reopened.getSnapshot().project, previous);
  const invalid = JSON.parse(session.serialize());
  invalid.tracks[0].clips = [
    {
      id: 'bad',
      name: 'Bank as audio',
      assetId: instrument.soundfontId,
      startBeat: 0,
      offsetSeconds: 0,
      durationSeconds: 1,
    },
  ];
  assert.throws(() => parseProject(JSON.stringify(invalid)), /missing audio/);
});
