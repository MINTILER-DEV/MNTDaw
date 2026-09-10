import { parseWav } from './audio-utils.ts';
import {
  type MidiNote,
  type Instrument,
  validateNotes,
  validateInstrument,
  defaultInstrument,
} from './midi.ts';
import {
  type Signature,
  type SignatureMarker,
  validateSignature,
} from './time-signatures.ts';

export const TRACK_COLORS = [
  '#b9de93',
  '#8cc9d5',
  '#c3a5e3',
  '#dea78a',
  '#d8cb86',
  '#94b4e3',
];
export const MAX_AUDIO_BYTES = 96 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 140 * 1024 * 1024;
export type Clip = {
  kind?: 'audio' | 'midi';
  notes?: MidiNote[];
  lengthBeats?: number;
  id: string;
  name: string;
  assetId: string;
  startBeat: number;
  offsetSeconds: number;
  durationSeconds: number;
};
export type Track = {
  kind?: 'audio' | 'midi';
  height?: number;
  instrument?: Instrument;
  id: string;
  name: string;
  color: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  clips: Clip[];
};
export type Project = {
  format: 'mnt-project';
  version: 1 | 2;
  id: string;
  name: string;
  tempo: number;
  timeSignature: Signature;
  signatureMarkers?: SignatureMarker[];
  positionBeats: number;
  master: { volume: number; muted: boolean };
  tracks: Track[];
  assets: {
    id: string;
    name: string;
    kind?: 'audio' | 'soundfont';
    encoding?: 'wav' | 'mp3';
  }[];
};
export const beatsToSeconds = (beats: number, tempo: number) =>
  (beats * 60) / tempo;
export const secondsToBeats = (seconds: number, tempo: number) =>
  (seconds * tempo) / 60;
export const snapBeat = (beat: number, snap: boolean, division = 1) =>
  Math.max(
    0,
    snap && division > 0 ? Math.round(beat / division) * division : beat,
  );
export const clipEndBeat = (clip: Clip, tempo: number) =>
  clip.startBeat +
  (clip.kind === 'midi'
    ? (clip.lengthBeats ?? 4)
    : secondsToBeats(clip.durationSeconds, tempo));
export function projectLength(project: Project) {
  const end = Math.max(
    0,
    ...(project.signatureMarkers ?? []).map((marker) => marker.beat),
    ...project.tracks.flatMap((track) =>
      track.clips.map((clip) => clipEndBeat(clip, project.tempo)),
    ),
  );
  return Math.max(64, Math.ceil((end + 4) / 16) * 16);
}
export function musicalPosition(beats: number) {
  const safe = Math.max(0, beats);
  return `${String(Math.floor(safe / 4) + 1).padStart(3, '0')}.${Math.floor(safe % 4) + 1}.${String(Math.floor((safe % 1) * 960)).padStart(3, '0')}`;
}
export function newTrack(
  index: number,
  kind: 'audio' | 'midi' = 'audio',
): Track {
  return {
    id: crypto.randomUUID(),
    name: `${kind === 'midi' ? 'Instrument' : 'Audio'} ${index + 1}`,
    ...(kind === 'midi' ? { kind, instrument: defaultInstrument() } : {}),
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    volume: 0,
    muted: false,
    solo: false,
    clips: [],
  };
}
export function newProject(): Project {
  return {
    format: 'mnt-project',
    version: 2,
    id: crypto.randomUUID(),
    name: 'Untitled project',
    tempo: 120,
    timeSignature: [4, 4],
    positionBeats: 0,
    master: { volume: -6, muted: false },
    tracks: [newTrack(0), newTrack(1)],
    assets: [],
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid project structure.');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`Invalid ${name}.`);
  return value;
}
function number(value: unknown, name: string, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`Invalid ${name}.`);
  return value;
}
function bool(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('Invalid mixer state.');
  return value;
}
function list(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(
      'Project exceeds the supported track, clip, or audio limit.',
    );
  return value as unknown[];
}
function unique(ids: string[], what: string) {
  if (new Set(ids).size !== ids.length)
    throw new Error(`Duplicate ${what} IDs in project.`);
}

export function encodeAudio(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  const parts: string[] = [];
  for (let i = 0; i < data.length; i += 32768)
    parts.push(String.fromCharCode(...data.subarray(i, i + 32768)));
  return btoa(parts.join(''));
}

export function serializeProject(
  project: Project,
  audio: Map<string, ArrayBuffer>,
) {
  let total = 0;
  const assets = project.assets.map((asset) => {
    const bytes = audio.get(asset.id);
    if (!bytes) throw new Error(`Missing audio: ${asset.name}.`);
    total += bytes.byteLength;
    if (total > MAX_AUDIO_BYTES)
      throw new Error('Projects support up to 96 MB of embedded WAV audio.');
    return { ...asset, data: encodeAudio(bytes) };
  });
  return JSON.stringify({ ...project, assets });
}

// Validate the complete document before touching the current session or audio graph.
export function parseProject(json: string): {
  project: Project;
  audio: Map<string, ArrayBuffer>;
} {
  if (json.length > MAX_PROJECT_BYTES)
    throw new Error('Project file is too large.');
  let input: Record<string, unknown>;
  try {
    input = object(JSON.parse(json));
  } catch {
    throw new Error('This is not a readable MNT project file.');
  }
  if (
    input.format !== 'mnt-project' ||
    (input.version !== 1 && input.version !== 2)
  )
    throw new Error('Unsupported project format or version.');
  const signature = validateSignature(input.timeSignature);
  const markers =
    input.signatureMarkers === undefined
      ? undefined
      : list(input.signatureMarkers, 1024)
          .map((value) => {
            const marker = object(value);
            return {
              id: text(marker.id, 'marker ID'),
              beat: number(marker.beat, 'marker position', 0, 100000),
              signature: validateSignature(marker.signature),
            };
          })
          .sort((a, b) => a.beat - b.beat);
  if (markers) {
    unique(
      markers.map((m) => m.id),
      'marker',
    );
    unique(
      markers.map((m) => String(m.beat)),
      'marker position',
    );
  }
  const audio = new Map<string, ArrayBuffer>();
  let total = 0,
    decodedEstimate = 0;
  const assets = list(input.assets, 128).map((value) => {
    const asset = object(value);
    const id = text(asset.id, 'asset ID');
    const name = text(asset.name, 'asset name');
    if (
      typeof asset.data !== 'string' ||
      asset.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)
    )
      throw new Error(`Invalid embedded audio: ${name}.`);
    total += asset.data.length * 0.75;
    if (total > MAX_AUDIO_BYTES + 256)
      throw new Error('Project audio exceeds 96 MB.');
    const binary = atob(asset.data);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
    if (asset.kind === 'soundfont') {
      if (
        bytes.byteLength < 12 ||
        String.fromCharCode(...new Uint8Array(bytes, 8, 4)) !== 'sfbk'
      )
        throw new Error('Invalid SoundFont file.');
    } else if (asset.encoding !== 'mp3') {
      const wav = parseWav(bytes);
      decodedEstimate += wav.frames * wav.channels * 4;
    }
    if (decodedEstimate > 384 * 1024 * 1024)
      throw new Error('Project audio exceeds the decoded memory limit.');
    if (audio.has(id)) throw new Error('Duplicate asset IDs in project.');
    audio.set(id, bytes);
    return {
      id,
      name,
      ...(asset.kind === 'soundfont' ? { kind: 'soundfont' as const } : {}),
      ...(asset.encoding === 'mp3' ? { encoding: 'mp3' as const } : {}),
    };
  });
  const tracks = list(input.tracks, 64).map((value) => {
    const track = object(value);
    const color = text(track.color, 'track color');
    if (!/^#[0-9a-fA-F]{6}$/.test(color))
      throw new Error('Invalid track color.');
    const clips = list(track.clips, 2048).map((value) => {
      const clip = object(value);
      if (clip.kind === 'midi') {
        const lengthBeats = number(
          clip.lengthBeats,
          'MIDI clip length',
          0.0625,
          4096,
        );
        return {
          id: text(clip.id, 'clip ID'),
          name: text(clip.name, 'clip name'),
          kind: 'midi' as const,
          assetId: '',
          startBeat: number(clip.startBeat, 'clip position', 0, 100000),
          offsetSeconds: 0,
          durationSeconds: 1,
          lengthBeats,
          notes: validateNotes(clip.notes, lengthBeats),
        };
      }
      const assetId = text(clip.assetId, 'asset reference');
      if (
        !audio.has(assetId) ||
        assets.find((a) => a.id === assetId)?.kind === 'soundfont'
      )
        throw new Error('A clip references missing audio.');
      return {
        id: text(clip.id, 'clip ID'),
        name: text(clip.name, 'clip name'),
        assetId,
        startBeat: number(clip.startBeat, 'clip position', 0, 100000),
        offsetSeconds: number(clip.offsetSeconds, 'source offset', 0, 86400),
        durationSeconds: number(
          clip.durationSeconds,
          'clip duration',
          Number.MIN_VALUE,
          86400,
        ),
      };
    });
    return {
      id: text(track.id, 'track ID'),
      name: text(track.name, 'track name'),
      color,
      volume: number(track.volume, 'track volume', -60, 6),
      muted: bool(track.muted),
      solo: bool(track.solo),
      clips,
      ...(track.height !== undefined
        ? { height: number(track.height, 'track height', 64, 320) }
        : {}),
      ...(track.kind === 'midi'
        ? {
            kind: 'midi' as const,
            instrument: validateInstrument(track.instrument),
          }
        : {}),
    };
  });
  unique(
    tracks.map((track) => track.id),
    'track',
  );
  const clips = tracks.flatMap((track) => track.clips);
  if (clips.length > 2048)
    throw new Error('Projects support up to 2048 clips.');
  unique(
    clips.map((clip) => clip.id),
    'clip',
  );
  const master = object(input.master);
  const project: Project = {
    format: 'mnt-project',
    version: input.version as 1 | 2,
    id: text(input.id, 'project ID'),
    name: text(input.name, 'project name'),
    tempo: number(input.tempo, 'tempo', 20, 300),
    timeSignature: signature,
    ...(markers ? { signatureMarkers: markers } : {}),
    positionBeats: number(input.positionBeats, 'playhead position', 0, 200000),
    master: {
      volume: number(master.volume, 'master volume', -60, 6),
      muted: bool(master.muted),
    },
    tracks,
    assets,
  };
  for (const track of tracks) {
    if (
      track.instrument?.type === 'soundfont' &&
      !assets.some(
        (asset) =>
          asset.id === track.instrument?.soundfontId &&
          asset.kind === 'soundfont',
      )
    )
      throw new Error('Missing SoundFont asset.');
    if (
      track.clips.some((clip) => clip.kind === 'midi') &&
      track.kind !== 'midi'
    )
      throw new Error('MIDI clips need an instrument track.');
    if (
      track.clips.some((clip) => clip.kind !== 'midi') &&
      track.kind === 'midi'
    )
      throw new Error('Audio clips need an audio track.');
  }
  if (project.positionBeats > projectLength(project))
    throw new Error('Saved playhead is outside the project timeline.');
  return { project, audio };
}
