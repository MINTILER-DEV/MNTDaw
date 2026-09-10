import { Midi } from '@tonejs/midi';
import { BasicMIDI } from 'spessasynth_core';
import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { Instrument, MidiNote } from './midi';
import { nativeHost } from './native-host';

export async function renderInstrument(
  instrument: Instrument,
  notes: MidiNote[],
  beats: number,
  tempo: number,
  bank?: ArrayBuffer,
) {
  const rate = 48000,
    duration = (beats * 60) / tempo + 2;
  if (duration > 300)
    throw new Error(
      'SoundFont and VST3 renders support clips up to 5 minutes. Split this clip first.',
    );
  const context = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  if (instrument.type === 'vst3') {
    const response = await nativeHost.request('/render', {
      pluginId: instrument.pluginId,
      parameters: instrument.parameters,
      duration,
      sampleRate: rate,
      notes: notes.map((note) => ({
        pitch: note.pitch,
        velocity: note.velocity,
        start: (note.start * 60) / tempo,
        duration: (note.length * 60) / tempo,
      })),
    });
    return context.decodeAudioData(await response.arrayBuffer());
  }
  if (!bank) throw new Error('This instrument is missing its SoundFont.');
  const midi = new Midi();
  midi.header.setTempo(tempo);
  const track = midi.addTrack();
  track.instrument.number = instrument.program ?? 0;
  track.addCC({
    number: 0,
    value: Math.floor((instrument.bank ?? 0) / 128) / 127,
    ticks: 0,
  });
  track.addCC({
    number: 32,
    value: ((instrument.bank ?? 0) % 128) / 127,
    ticks: 0,
  });
  for (const note of notes)
    track.addNote({
      midi: note.pitch,
      ticks: Math.round(note.start * midi.header.ppq),
      durationTicks: Math.max(1, Math.round(note.length * midi.header.ppq)),
      velocity: note.velocity / 127,
    });
  const data = Uint8Array.from(midi.toArray()).buffer;
  await context.audioWorklet.addModule(processorUrl);
  const synth = new WorkletSynthesizer(context);
  synth.connect(context.destination);
  try {
    await synth.startOfflineRender({
      midiSequence: BasicMIDI.fromArrayBuffer(data),
      soundBankList: [{ bankOffset: 0, soundBankBuffer: bank.slice(0) }],
      loopCount: 0,
    });
    return await context.startRendering();
  } finally {
    synth.destroy();
  }
}

const live = new WeakMap<
  AudioNode,
  { key: string; ready: Promise<WorkletSynthesizer> }
>();
const worklets = new WeakMap<AudioContext, Promise<void>>();
export async function soundfontPreview(
  context: AudioContext,
  output: AudioNode,
  instrument: Instrument,
  bank: ArrayBuffer,
  pitch: number,
  velocity: number,
) {
  const key = `${instrument.soundfontId}:${instrument.program}:${instrument.bank}`;
  let entry = live.get(output);
  if (entry?.key !== key) {
    const old = entry;
    const ready = (async () => {
      if (old) (await old.ready.catch(() => null))?.destroy();
      let worklet = worklets.get(context);
      if (!worklet) {
        worklet = context.audioWorklet.addModule(processorUrl);
        worklets.set(context, worklet);
      }
      await worklet;
      const synth = new WorkletSynthesizer(context);
      try {
        await synth.isReady;
        await synth.soundBankManager.addSoundBank(bank.slice(0), 'live');
        synth.controllerChange(0, 0, Math.floor((instrument.bank ?? 0) / 128));
        synth.controllerChange(0, 32, (instrument.bank ?? 0) % 128);
        synth.programChange(0, instrument.program ?? 0);
        synth.connect(output);
        return synth;
      } catch (error) {
        synth.destroy();
        throw error;
      }
    })();
    entry = { key, ready };
    live.set(output, entry);
  }
  const current = entry;
  const synth = await current.ready.catch((error) => {
    if (live.get(output) === current) live.delete(output);
    throw error;
  });
  if (live.get(output) !== current) return () => {};
  synth.noteOn(0, pitch, velocity);
  return () => synth.noteOff(0, pitch);
}
