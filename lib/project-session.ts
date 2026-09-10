import { AudioEngine } from './audio-engine.ts';
import {
  beatsToSeconds,
  secondsToBeats,
  newProject,
  newTrack,
  parseProject,
  serializeProject,
  projectLength,
  MAX_AUDIO_BYTES,
  MAX_PROJECT_BYTES,
  type Project,
  type Clip,
  type Track,
} from './project.ts';
import { defaultInstrument } from './midi.ts';
import type { MidiNote } from './midi.ts';
import { splitClip } from './editing.ts';

export type AudioAsset = Awaited<ReturnType<AudioEngine['decodeFile']>>;
type SessionSnapshot = {
  project: Project;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export class ProjectSession {
  readonly engine = new AudioEngine();
  assets = new Map<string, AudioAsset>();
  soundfonts = new Map<string, ArrayBuffer>();
  presets = new Map<
    string,
    { name: string; program: number; bank: number }[]
  >();
  private renders = new Map<string, AudioBuffer>();
  private clipboard: { track?: Track; clip?: Clip } | null = null;
  private noteClipboard: MidiNote[] = [];
  copyNotes(notes: MidiNote[]) {
    this.noteClipboard = structuredClone(notes);
  }
  copiedNotes() {
    return structuredClone(this.noteClipboard);
  }
  split(trackId: string, clipId: string, beat: number) {
    const project = this.state.project;
    const clip = project.tracks
      .find((t) => t.id === trackId)
      ?.clips.find((c) => c.id === clipId);
    if (!clip) return '';
    if (project.tracks.reduce((sum, t) => sum + t.clips.length, 0) >= 2048)
      throw new Error('Maximum 2048 clips.');
    const halves = splitClip(clip, beat, project.tempo);
    this.edit((p) => ({
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: t.clips.flatMap((c) => (c.id === clipId ? halves : [c])),
            }
          : t,
      ),
    }));
    return halves[1].id;
  }
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private listeners = new Set<() => void>();
  private state: SessionSnapshot = {
    project: newProject(),
    dirty: false,
    canUndo: false,
    canRedo: false,
  };
  constructor() {
    this.apply(this.state.project);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify(project: Project, dirty: boolean) {
    this.state = {
      project,
      dirty,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
    this.listeners.forEach((listener) => listener());
  }
  private atCursor(project = this.state.project) {
    return {
      ...project,
      positionBeats: secondsToBeats(
        this.engine.position,
        this.state.project.tempo,
      ),
    };
  }
  private apply(project: Project) {
    const old = this.state.project;
    if (
      old.tracks !== project.tracks ||
      old.tempo !== project.tempo ||
      this.engine.getSnapshot().duration === 0
    ) {
      this.engine.setArrangement(
        project.tracks.map((track) => ({
          ...track,
          notes:
            track.instrument?.type === 'synth'
              ? track.clips.flatMap((clip) =>
                  (clip.notes ?? []).map((note) => ({
                    pitch: note.pitch,
                    velocity: note.velocity,
                    start: beatsToSeconds(
                      clip.startBeat + note.start,
                      project.tempo,
                    ),
                    duration: beatsToSeconds(note.length, project.tempo),
                  })),
                )
              : [],
          clips: track.clips.flatMap((clip) => {
            if (clip.kind === 'midi') {
              const buffer = this.renders.get(
                this.renderKey(track, clip, project.tempo),
              );
              return buffer
                ? [
                    {
                      buffer,
                      start: beatsToSeconds(clip.startBeat, project.tempo),
                      offset: 0,
                      duration: buffer.duration,
                    },
                  ]
                : [];
            }
            const asset = this.assets.get(clip.assetId);
            if (!asset) throw new Error('A clip is missing its source audio.');
            return [
              {
                buffer: asset.buffer,
                start: beatsToSeconds(clip.startBeat, project.tempo),
                offset: clip.offsetSeconds,
                duration: clip.durationSeconds,
              },
            ];
          }),
        })),
        beatsToSeconds(projectLength(project), project.tempo),
      );
    }
    this.engine.setVolume(project.master.volume);
    this.engine.setMuted(project.master.muted);
    if (old.tempo !== project.tempo)
      this.engine.seek(beatsToSeconds(project.positionBeats, project.tempo));
  }
  edit(change: (project: Project) => Project) {
    const previous = this.atCursor();
    const project = change(previous);
    if (project === previous) return;
    if (
      this.engine.getSnapshot().status === 'playing' &&
      project.tracks.some(
        (t) =>
          t.kind === 'midi' &&
          t.instrument?.type !== 'synth' &&
          t.clips.some(
            (c) => !this.renders.has(this.renderKey(t, c, project.tempo)),
          ),
      )
    )
      this.engine.pause();
    this.apply(project);
    this.undoStack = [...this.undoStack.slice(-49), previous];
    this.redoStack = [];
    this.notify(project, true);
  }
  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.atCursor());
    this.apply(previous);
    this.engine.seek(beatsToSeconds(previous.positionBeats, previous.tempo));
    this.notify(previous, true);
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.atCursor());
    this.apply(next);
    this.engine.seek(beatsToSeconds(next.positionBeats, next.tempo));
    this.notify(next, true);
  }
  reset() {
    this.engine.stop();
    this.assets = new Map();
    this.soundfonts.clear();
    this.presets.clear();
    this.renders.clear();
    this.clipboard = null;
    this.noteClipboard = [];
    this.undoStack = [];
    this.redoStack = [];
    const project = newProject();
    this.apply(project);
    this.notify(project, false);
  }
  async importFiles(files: File[], trackId: string | null, startBeat: number) {
    if (!files.length) return [];
    if (
      this.state.project.tracks.find((track) => track.id === trackId)?.kind ===
      'midi'
    )
      throw new Error(
        'Import audio onto an audio track, or choose new tracks.',
      );
    if (this.state.project.assets.length + files.length > 128)
      throw new Error('Projects support up to 128 audio files.');
    if (
      !this.state.project.tracks.some((track) => track.id === trackId) &&
      this.state.project.tracks.length + files.length > 64
    )
      throw new Error('Projects support up to 64 tracks.');
    if (
      this.state.project.tracks.flatMap((track) => track.clips).length +
        files.length >
      2048
    )
      throw new Error('Projects support up to 2048 clips.');
    let encoded = [...this.assets.values()].reduce(
      (sum, asset) => sum + asset.bytes.byteLength,
      0,
    );
    encoded += [...this.soundfonts.values()].reduce(
      (sum, bytes) => sum + bytes.byteLength,
      0,
    );
    let decoded = [...this.assets.values()].reduce(
      (sum, asset) =>
        sum + asset.buffer.length * asset.buffer.numberOfChannels * 4,
      0,
    );
    const prepared: { id: string; name: string; asset: AudioAsset }[] = [];
    for (const file of files) {
      encoded += file.size;
      if (encoded > MAX_AUDIO_BYTES)
        throw new Error('Projects support up to 96 MB of WAV audio.');
      const asset = await this.engine.decodeFile(file);
      decoded += asset.buffer.length * asset.buffer.numberOfChannels * 4;
      if (decoded > 384 * 1024 * 1024)
        throw new Error('Project audio exceeds the decoded memory limit.');
      prepared.push({
        id: crypto.randomUUID(),
        name: file.name.slice(0, 160).trim() || 'Audio.wav',
        asset,
      });
    }
    prepared.forEach((item) => this.assets.set(item.id, item.asset));
    const ids: string[] = [];
    this.edit((project) => {
      const tracks = [...project.tracks];
      let cursor = Math.max(0, Math.min(100000, startBeat));
      prepared.forEach((item) => {
        let index = tracks.findIndex((track) => track.id === trackId);
        if (index < 0) {
          index = tracks.length;
          tracks.push({
            ...newTrack(index),
            name:
              item.name.replace(/\.(wav|mp3)$/i, '').trim() || 'Audio track',
          });
        }
        const clip = {
          id: crypto.randomUUID(),
          name: item.name.replace(/\.(wav|mp3)$/i, '').trim() || 'Audio clip',
          assetId: item.id,
          startBeat: Math.max(
            0,
            Math.min(100000, trackId ? cursor : startBeat),
          ),
          offsetSeconds: 0,
          durationSeconds: item.asset.buffer.duration,
        };
        ids.push(clip.id);
        tracks[index] = {
          ...tracks[index],
          clips: [...tracks[index].clips, clip],
        };
        cursor += secondsToBeats(clip.durationSeconds, project.tempo);
      });
      return {
        ...project,
        tracks,
        assets: [
          ...project.assets,
          ...prepared.map(({ id, name }) => ({
            id,
            name,
            ...(/\.mp3$/i.test(name) ? { encoding: 'mp3' as const } : {}),
          })),
        ],
      };
    });
    return ids;
  }
  async open(file: File) {
    if (file.size > MAX_PROJECT_BYTES)
      throw new Error('Choose an MNT project smaller than 140 MB.');
    const { project, audio } = parseProject(await file.text());
    const prepared = new Map<string, AudioAsset>();
    const banks = new Map<string, ArrayBuffer>();
    const bankPresets = new Map<
      string,
      { name: string; program: number; bank: number }[]
    >();
    let memory = 0;
    for (const asset of project.assets) {
      if (asset.kind === 'soundfont') {
        const bytes = audio.get(asset.id)!;
        const runtime = await import('./soundfont.ts');
        bankPresets.set(asset.id, runtime.inspectSoundfont(bytes));
        banks.set(asset.id, bytes);
        continue;
      }
      const decoded = await this.engine.decodeFile(
        new File(
          [audio.get(asset.id)!],
          asset.encoding === 'mp3' ? `${asset.name}.mp3` : asset.name,
        ),
      );
      memory += decoded.buffer.length * decoded.buffer.numberOfChannels * 4;
      if (memory > 384 * 1024 * 1024)
        throw new Error('Project audio exceeds the decoded memory limit.');
      prepared.set(asset.id, decoded);
    }
    for (const track of project.tracks)
      for (const clip of track.clips) {
        if (clip.kind === 'midi') continue;
        if (
          clip.offsetSeconds + clip.durationSeconds >
          prepared.get(clip.assetId)!.buffer.duration + 0.002
        )
          throw new Error(
            `Clip "${clip.name}" extends beyond its source audio.`,
          );
      }
    this.engine.stop();
    this.assets = prepared;
    this.soundfonts = banks;
    this.presets = bankPresets;
    this.renders.clear();
    this.clipboard = null;
    this.noteClipboard = [];
    this.undoStack = [];
    this.redoStack = [];
    this.apply(project);
    this.engine.seek(beatsToSeconds(project.positionBeats, project.tempo));
    this.notify(project, false);
  }
  serialize() {
    return serializeProject(
      { ...this.atCursor(), version: 2 },
      new Map(
        [...this.assets]
          .map(([id, asset]) => [id, asset.bytes] as [string, ArrayBuffer])
          .concat([...this.soundfonts]),
      ),
    );
  }
  markDownloaded() {
    this.notify(this.atCursor(), false);
  }
  private renderKey(track: Track, clip: Clip, tempo: number) {
    return JSON.stringify([
      track.instrument,
      clip.notes,
      clip.lengthBeats,
      tempo,
    ]);
  }
  async play() {
    const project = this.state.project;
    const used = new Set(
      project.tracks.flatMap((t) =>
        t.clips
          .filter((c) => c.kind === 'midi')
          .map((c) => this.renderKey(t, c, project.tempo)),
      ),
    );
    for (const key of this.renders.keys())
      if (!used.has(key)) this.renders.delete(key);
    let memory = [...this.renders.values()].reduce(
      (sum, b) => sum + b.length * b.numberOfChannels * 4,
      0,
    );
    const instrumentTrack = project.tracks.find((t) => t.kind === 'midi');
    if (instrumentTrack) await this.engine.liveOutput(instrumentTrack.id);
    for (const track of project.tracks)
      if (track.kind === 'midi' && track.instrument?.type !== 'synth') {
        for (const clip of track.clips) {
          const key = this.renderKey(track, clip, project.tempo);
          if (!this.renders.has(key)) {
            const runtime = await import('./instrument-runtime');
            const buffer = await runtime.renderInstrument(
              track.instrument!,
              clip.notes ?? [],
              clip.lengthBeats ?? 4,
              project.tempo,
              this.soundfonts.get(track.instrument?.soundfontId ?? ''),
            );
            memory += buffer.length * buffer.numberOfChannels * 4;
            if (memory > 384 * 1024 * 1024)
              throw new Error(
                'Instrument renders exceed 384 MB. Shorten clips or use the built-in synth.',
              );
            this.renders.set(key, buffer);
          }
        }
      }
    this.apply({ ...project, tracks: [...project.tracks] });
    await this.engine.play();
  }
  async preview(trackId: string, pitch: number, velocity: number) {
    const track = this.state.project.tracks.find(
      (track) => track.id === trackId,
    );
    const instrument = track?.instrument ?? defaultInstrument();
    if (instrument.type === 'synth')
      return this.engine.previewSynth(trackId, instrument, pitch, velocity);
    if (instrument.type === 'vst3')
      throw new Error(
        'VST3 instruments render on playback. Use Play to hear this phrase through the native host.',
      );
    const bank = this.soundfonts.get(instrument.soundfontId!);
    if (!bank) throw new Error('Load a SoundFont first.');
    const { context, output } = await this.engine.liveOutput(trackId);
    const runtime = await import('./instrument-runtime');
    return this.engine.registerLive(
      await runtime.soundfontPreview(
        context,
        output,
        instrument,
        bank,
        pitch,
        velocity,
      ),
    );
  }
  addMidiClip(trackId: string, beat: number) {
    if (
      this.state.project.tracks.find((t) => t.id === trackId)?.kind !== 'midi'
    )
      throw new Error('Choose an instrument track.');
    if (
      this.state.project.tracks.reduce((sum, t) => sum + t.clips.length, 0) >=
      2048
    )
      throw new Error('Maximum 2048 clips.');
    const clip: Clip = {
      id: crypto.randomUUID(),
      name: 'MIDI pattern',
      kind: 'midi',
      assetId: '',
      startBeat: Math.max(0, Math.min(100000, beat)),
      offsetSeconds: 0,
      durationSeconds: 1,
      lengthBeats: 4,
      notes: [],
    };
    this.edit((p) => ({
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t,
      ),
    }));
    return clip.id;
  }
  async loadSoundfont(trackId: string, file: File) {
    if (this.state.project.assets.length >= 128)
      throw new Error('Maximum 128 media assets.');
    if (
      this.state.project.tracks.find((t) => t.id === trackId)?.kind !== 'midi'
    )
      throw new Error('Choose an instrument track.');
    const total =
      [...this.assets.values()].reduce(
        (sum, a) => sum + a.bytes.byteLength,
        0,
      ) +
      [...this.soundfonts.values()].reduce((sum, b) => sum + b.byteLength, 0);
    if (total + file.size > MAX_AUDIO_BYTES)
      throw new Error('Embedded media exceeds 96 MB.');
    const bytes = await file.arrayBuffer();
    const runtime = await import('./soundfont.ts');
    const presets = runtime.inspectSoundfont(bytes);
    if (!presets.length) throw new Error('The SoundFont contains no presets.');
    const id = crypto.randomUUID();
    this.soundfonts.set(id, bytes);
    this.presets.set(id, presets);
    this.edit((p) => ({
      ...p,
      assets: [
        ...p.assets,
        { id, name: file.name.slice(0, 160), kind: 'soundfont' },
      ],
      tracks: p.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              instrument: {
                type: 'soundfont',
                soundfontId: id,
                program: presets[0].program,
                bank: presets[0].bank,
                parameters: {},
              },
            }
          : t,
      ),
    }));
  }
  async importMidi(file: File, beat: number) {
    if (file.size > 8 * 1024 * 1024)
      throw new Error('MIDI files must be under 8 MB.');
    const midiModule = await import('@tonejs/midi');
    const Midi =
      midiModule.Midi ??
      (midiModule as unknown as { default: { Midi: typeof midiModule.Midi } })
        .default.Midi;
    const midi = new Midi(await file.arrayBuffer());
    const imported = midi.tracks
      .filter((t) => t.notes.length)
      .map((t, index) => {
        const track = newTrack(
          this.state.project.tracks.length + index,
          'midi',
        );
        track.name = t.name.slice(0, 160) || track.name;
        const notes = t.notes.map((n) => ({
          id: crypto.randomUUID(),
          pitch: n.midi,
          start: n.ticks / midi.header.ppq,
          length: Math.max(1, n.durationTicks) / midi.header.ppq,
          velocity: Math.max(1, Math.round(n.velocity * 127)),
        }));
        const lengthBeats = Math.max(
          4,
          Math.ceil(
            notes.reduce((end, n) => Math.max(end, n.start + n.length), 0),
          ),
        );
        if (notes.length > 8192 || lengthBeats > 4096)
          throw new Error('This MIDI track exceeds 8192 notes or 4096 beats.');
        track.clips = [
          {
            id: crypto.randomUUID(),
            name: track.name,
            kind: 'midi',
            assetId: '',
            startBeat: Math.max(0, Math.min(100000, beat)),
            offsetSeconds: 0,
            durationSeconds: 1,
            notes,
            lengthBeats,
          },
        ];
        return track;
      });
    if (
      !imported.length ||
      imported.length + this.state.project.tracks.length > 64
    )
      throw new Error(
        'No MIDI notes found, or the project would exceed 64 tracks.',
      );
    this.edit((p) => ({ ...p, tracks: [...p.tracks, ...imported] }));
    return imported[0].clips[0].id;
  }
  copy(trackId: string, clipId?: string, cut = false) {
    const track = this.state.project.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const clip = clipId ? track.clips.find((c) => c.id === clipId) : undefined;
    if (clipId && !clip) return;
    this.clipboard = structuredClone(clip ? { clip } : { track });
    if (cut) this.remove(trackId, clipId);
  }
  remove(trackId: string, clipId?: string) {
    this.edit((p) => ({
      ...p,
      tracks: clipId
        ? p.tracks.map((t) =>
            t.id === trackId
              ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
              : t,
          )
        : p.tracks.filter((t) => t.id !== trackId),
    }));
  }
  duplicate(trackId: string, clipId?: string) {
    const previous = this.clipboard;
    try {
      const track = this.state.project.tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (!track || (clipId && !clip)) return '';
      this.copy(trackId, clipId);
      return this.paste(
        trackId,
        clip
          ? clip.startBeat +
              (clip.kind === 'midi'
                ? (clip.lengthBeats ?? 4)
                : secondsToBeats(
                    clip.durationSeconds,
                    this.state.project.tempo,
                  ))
          : 0,
      );
    } finally {
      this.clipboard = previous;
    }
  }
  paste(trackId: string, beat: number) {
    if (!this.clipboard) return '';
    const adding = this.clipboard.track?.clips.length ?? 1;
    if (
      this.state.project.tracks.reduce((sum, t) => sum + t.clips.length, 0) +
        adding >
      2048
    )
      throw new Error('Maximum 2048 clips.');
    const cloneClip = (c: Clip): Clip => ({
      ...structuredClone(c),
      id: crypto.randomUUID(),
      notes: c.notes?.map((n) => ({ ...n, id: crypto.randomUUID() })),
    });
    if (this.clipboard.track) {
      if (this.state.project.tracks.length >= 64)
        throw new Error('Maximum 64 tracks.');
      const track = {
        ...structuredClone(this.clipboard.track),
        id: crypto.randomUUID(),
        clips: this.clipboard.track.clips.map(cloneClip),
      };
      this.edit((p) => ({ ...p, tracks: [...p.tracks, track] }));
      return track.id;
    }
    const clip = cloneClip(this.clipboard.clip!);
    clip.startBeat = Math.max(0, Math.min(100000, beat));
    const target = this.state.project.tracks.find((t) => t.id === trackId);
    if (!target || (target.kind === 'midi') !== (clip.kind === 'midi'))
      throw new Error(
        'Paste MIDI onto an instrument track, and audio onto an audio track.',
      );
    this.edit((p) => ({
      ...p,
      tracks: p.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t,
      ),
    }));
    return clip.id;
  }
}
