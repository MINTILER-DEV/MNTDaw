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
} from './project.ts';

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
          clips: track.clips.map((clip) => {
            const asset = this.assets.get(clip.assetId);
            if (!asset) throw new Error('A clip is missing its source audio.');
            return {
              buffer: asset.buffer,
              start: beatsToSeconds(clip.startBeat, project.tempo),
              offset: clip.offsetSeconds,
              duration: clip.durationSeconds,
            };
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
    this.undoStack = [];
    this.redoStack = [];
    const project = newProject();
    this.apply(project);
    this.notify(project, false);
  }
  async importFiles(files: File[], trackId: string | null, startBeat: number) {
    if (!files.length) return [];
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
            name: item.name.replace(/\.wav$/i, '').trim() || 'Audio track',
          });
        }
        const clip = {
          id: crypto.randomUUID(),
          name: item.name.replace(/\.wav$/i, '').trim() || 'Audio clip',
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
          ...prepared.map(({ id, name }) => ({ id, name })),
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
    let memory = 0;
    for (const asset of project.assets) {
      const decoded = await this.engine.decodeFile(
        new File([audio.get(asset.id)!], asset.name),
      );
      memory += decoded.buffer.length * decoded.buffer.numberOfChannels * 4;
      if (memory > 384 * 1024 * 1024)
        throw new Error('Project audio exceeds the decoded memory limit.');
      prepared.set(asset.id, decoded);
    }
    for (const track of project.tracks)
      for (const clip of track.clips) {
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
    this.undoStack = [];
    this.redoStack = [];
    this.apply(project);
    this.engine.seek(beatsToSeconds(project.positionBeats, project.tempo));
    this.notify(project, false);
  }
  serialize() {
    return serializeProject(
      this.atCursor(),
      new Map([...this.assets].map(([id, asset]) => [id, asset.bytes])),
    );
  }
  markDownloaded() {
    this.notify(this.atCursor(), false);
  }
}
