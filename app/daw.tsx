'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  AudioLines,
  ChevronDown,
  ChevronRight,
  Copy,
  FileAudio2,
  FilePlus2,
  FolderOpen,
  GripVertical,
  Headphones,
  Keyboard,
  Layers3,
  LoaderCircle,
  Magnet,
  Maximize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Piano,
  Play,
  Plus,
  Redo2,
  Save,
  Settings2,
  ShieldCheck,
  SkipBack,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
  AudioSettings,
  Choice,
  IconButton,
  LevelMeter,
  NumberField,
} from '@/components/daw-controls';
import { PianoRoll } from '@/components/piano-roll';
import { InstrumentPanel } from '@/components/instrument-panel';
import { EditMenu, type EditAction } from '@/components/edit-menu';
import {
  signatureBars,
  signaturePosition,
  type Signature,
  type SignatureMarker,
} from '@/lib/time-signatures';
import { ProjectSession } from '@/lib/project-session';
import {
  beatsToSeconds,
  secondsToBeats,
  clipEndBeat,
  newTrack,
  projectLength,
  snapBeat,
  type Clip,
  type Track,
} from '@/lib/project';
import { formatTime, waveformPeaks } from '@/lib/audio-utils';

const ROW_HEIGHT = 98;
const HEADER_WIDTH = 206;
type Drag = {
  clipId: string;
  trackId: string;
  targetId: string;
  x: number;
  y: number;
  start: number;
  duration: number;
  mode: 'move' | 'trim';
  moved: boolean;
};

function ClipWave({
  buffer,
  offset,
  duration,
}: {
  buffer: AudioBuffer;
  offset: number;
  duration: number;
}) {
  const path = useMemo(() => {
    const channel = buffer.getChannelData(0);
    const data = channel.subarray(
      Math.floor(offset * buffer.sampleRate),
      Math.min(
        channel.length,
        Math.ceil((offset + duration) * buffer.sampleRate),
      ),
    );
    return waveformPeaks(data, 480)
      .map(([min, max], i) => `M${i + 0.5},${25 - max * 22}V${25 - min * 22}`)
      .join(' ');
  }, [buffer, offset, duration]);
  return (
    <svg
      className="clip-wave"
      viewBox="0 0 480 50"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M0 25H480" className="clip-baseline" />
      <path d={path} />
    </svg>
  );
}

export default function Daw() {
  const [session] = useState(() => new ProjectSession());
  const { engine } = session;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { project, dirty, canUndo, canRedo } = snapshot;
  const audio = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [position, setPosition] = useState(0);
  const [levels, setLevels] = useState<number[]>([0, 0]);
  const [clipped, setClipped] = useState(false);
  const [selectedTrackId, selectTrack] = useState(project.tracks[0]?.id ?? '');
  const [selectedClipId, selectClip] = useState('');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [roll, setRoll] = useState(false);
  const [signatureEdit, setSignatureEdit] = useState<{
    id?: string;
    beat: number;
    signature: Signature;
  } | null>(null);
  const [resize, setResize] = useState<{
    id: string;
    y: number;
    initial: number;
    height: number;
  } | null>(null);
  const resizeRef = useRef<typeof resize>(null);
  const [discard, setDiscard] = useState<'new' | 'open' | null>(null);
  const [library, setLibrary] = useState(
    () => window.matchMedia('(min-width: 1101px)').matches,
  );
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(26);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const midiInput = useRef<HTMLInputElement>(null);
  const wavInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const importTarget = useRef<{ trackId: string | null; beat: number }>({
    trackId: null,
    beat: 0,
  });
  const selectedTrack =
    project.tracks.find((track) =>
      track.clips.some((clip) => clip.id === selectedClipId),
    ) ??
    project.tracks.find((track) => track.id === selectedTrackId) ??
    project.tracks[0];
  const selectedClip = selectedTrack?.clips.find(
    (clip) => clip.id === selectedClipId,
  );
  const selectedAsset = selectedClip
    ? session.assets.get(selectedClip.assetId)
    : undefined;
  const length = projectLength(project);
  const beat = secondsToBeats(position, project.tempo);
  const playing = audio.status === 'playing';
  const totalClips = project.tracks.reduce(
    (sum, track) => sum + track.clips.length,
    0,
  );
  const timelineWidth = length * zoom;
  const markers = project.signatureMarkers ?? [];
  const bars = useMemo(
    () =>
      signatureBars(
        project.timeSignature,
        project.signatureMarkers ?? [],
        length,
        Math.max(32 / zoom, length / 4000),
      ),
    [project.timeSignature, project.signatureMarkers, length, zoom],
  );
  const currentSignature =
    [...markers]
      .sort((a, b) => a.beat - b.beat)
      .filter((m) => m.beat <= beat)
      .at(-1)?.signature ?? project.timeSignature;
  const rowHeight = (track: Track) =>
    resize?.id === track.id ? resize.height : (track.height ?? ROW_HEIGHT);
  const rowTop = (id: string) => {
    let top = 0;
    for (const t of project.tracks) {
      if (t.id === id) return top;
      top += rowHeight(t);
    }
    return top;
  };
  const anySolo = project.tracks.some((track) => track.solo);
  const report = useCallback((text: string) => setMessage(text), []);

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(label);
      setError('');
      setMessage('');
      try {
        await action();
      } catch (error) {
        setError(
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Permission was not granted. You can keep using the current output.'
            : error instanceof Error
              ? error.message
              : 'Something went wrong. Please try again.',
        );
      } finally {
        busyRef.current = false;
        setBusy('');
      }
    },
    [],
  );

  useEffect(() => {
    let frame = 0,
      last = 0;
    const tick = (time: number) => {
      if (time - last > 32) {
        setPosition(engine.position);
        const next = engine.readLevels();
        setLevels((old) => {
          const values = next.map((value, index) => {
            const peak = Math.max(value, old[index] * 0.82);
            return peak < 0.0001 ? 0 : peak;
          });
          return values.every((value, index) => value === old[index])
            ? old
            : values;
        });
        if (next.some((value) => value >= 1)) setClipped(true);
        last = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);

  const seek = (nextBeat: number) =>
    engine.seek(
      beatsToSeconds(Math.max(0, Math.min(length, nextBeat)), project.tempo),
    );
  const changeTrack = (id: string, update: Partial<Track>) =>
    session.edit((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track) =>
        track.id === id ? { ...track, ...update } : track,
      ),
    }));
  const changeClip = (id: string, update: Partial<Clip>) =>
    session.edit((previous) => ({
      ...previous,
      tracks: previous.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === id ? { ...clip, ...update } : clip,
        ),
      })),
    }));

  const addTrack = (kind: 'audio' | 'midi' = 'audio') => {
    if (project.tracks.length >= 64) {
      setError('Projects support up to 64 tracks.');
      return;
    }
    const track = newTrack(project.tracks.length, kind);
    session.edit((previous) => ({
      ...previous,
      tracks: [...previous.tracks, track],
    }));
    selectTrack(track.id);
    selectClip('');
  };
  const duplicateClip = () => {
    if (!selectedClip || !selectedTrack) return;
    if (totalClips >= 2048) {
      setError('Projects support up to 2048 clips.');
      return;
    }
    const copy = {
      ...selectedClip,
      notes: selectedClip.notes?.map((n) => ({
        ...n,
        id: crypto.randomUUID(),
      })),
      id: crypto.randomUUID(),
      startBeat: Math.min(100000, clipEndBeat(selectedClip, project.tempo)),
    };
    changeTrack(selectedTrack.id, { clips: [...selectedTrack.clips, copy] });
    selectClip(copy.id);
  };
  const deleteClip = () => {
    if (!selectedClip || !selectedTrack) return;
    changeTrack(selectedTrack.id, {
      clips: selectedTrack.clips.filter((clip) => clip.id !== selectedClip.id),
    });
    selectClip('');
  };
  const deleteTrack = () => {
    if (!selectedTrack) return;
    session.edit((previous) => ({
      ...previous,
      tracks: previous.tracks.filter((track) => track.id !== selectedTrack.id),
    }));
    selectClip('');
  };
  const insertAsset = (assetId: string, trackId: string, start: number) => {
    const asset = session.assets.get(assetId);
    const metadata = project.assets.find((item) => item.id === assetId);
    const track = project.tracks.find((item) => item.id === trackId);
    if (!asset || !metadata || !track || track.kind === 'midi') return;
    if (totalClips >= 2048) {
      setError('Projects support up to 2048 clips.');
      return;
    }
    const clip: Clip = {
      id: crypto.randomUUID(),
      name: metadata.name.replace(/\.(wav|mp3)$/i, '').trim() || 'Audio clip',
      assetId,
      startBeat: snapBeat(start, snap),
      offsetSeconds: 0,
      durationSeconds: asset.buffer.duration,
    };
    changeTrack(trackId, { clips: [...track.clips, clip] });
    selectTrack(trackId);
    selectClip(clip.id);
  };
  const importWavs = (
    files: File[],
    target: { trackId: string | null; beat: number },
  ) =>
    void run('Importing audio', async () => {
      for (const file of files.filter((f) => /\.midi?$/i.test(f.name))) {
        selectClip(await session.importMidi(file, snapBeat(target.beat, snap)));
        setRoll(true);
      }
      const audioFiles = files.filter((f) => !/\.midi?$/i.test(f.name));
      const ids = await session.importFiles(
        audioFiles,
        target.trackId,
        snapBeat(target.beat, snap),
      );
      if (ids.length) selectClip(ids[0]);
      setMessage(
        `${files.length} audio file${files.length === 1 ? '' : 's'} imported.`,
      );
    });
  const chooseWavs = (trackId: string | null) => {
    importTarget.current = {
      trackId:
        project.tracks.find((t) => t.id === trackId)?.kind === 'midi'
          ? null
          : trackId,
      beat,
    };
    wavInput.current?.click();
  };

  const save = useCallback(
    () =>
      void run('Saving project', async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const json = session.serialize();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const fileName = session
          .getSnapshot()
          .project.name.replace(/[<>:"/\\|?*]/g, '_')
          .split('')
          .map((char) => (char.charCodeAt(0) < 32 ? '_' : char))
          .join('');
        link.download = `${fileName || 'Untitled project'}.mnt`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        session.markDownloaded();
        setMessage('Project downloaded with its audio included.');
      }),
    [run, session],
  );
  const performFileAction = (action: 'new' | 'open') => {
    if (action === 'open') projectInput.current?.click();
    else {
      session.reset();
      selectClip('');
      selectTrack(session.getSnapshot().project.tracks[0].id);
      setClipped(false);
      setMessage('New project created.');
      if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    }
  };
  const fileAction = (action: 'new' | 'open') => {
    if (session.getSnapshot().dirty) setDiscard(action);
    else performFileAction(action);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (busyRef.current || help || settings || discard || signatureEdit)
        return;
      const target = event.target as HTMLElement;
      const typing = !!target.closest(
        'input, textarea, select, [role="combobox"], [role="slider"], [contenteditable="true"]',
      );
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (typing) (target as HTMLInputElement).blur();
        save();
        return;
      }
      if (typing || target.closest('[role="menu"]')) return;
      if (
        command &&
        !target.closest('[data-piano-roll]') &&
        ['c', 'x', 'v', 'd'].includes(event.key.toLowerCase()) &&
        selectedTrack
      ) {
        event.preventDefault();
        const key = event.key.toLowerCase();
        void run('Editing selection', async () => {
          if (key === 'v') session.paste(selectedTrack.id, beat);
          else if (key === 'd')
            session.duplicate(selectedTrack.id, selectedClipId || undefined);
          else
            session.copy(
              selectedTrack.id,
              selectedClipId || undefined,
              key === 'x',
            );
        });
        return;
      }
      if (command && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (session.getSnapshot().dirty) setDiscard('open');
        else projectInput.current?.click();
        return;
      }
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) session.redo();
        else session.undo();
        return;
      }
      if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        session.redo();
        return;
      }
      if (
        event.code === 'Space' &&
        !event.repeat &&
        (!target.closest('button') ||
          target.closest('.arrangement-clip, .bar-ruler, [data-piano-roll]'))
      ) {
        event.preventDefault();
        if (engine.getSnapshot().status === 'playing') engine.pause();
        else void run('Starting audio', () => session.play());
      }
      if (event.key === 'Escape') {
        engine.stop();
        selectClip('');
      }
      if (target.closest('[data-piano-roll]')) return;
      if (selectedTrack && ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault();
        session.remove(selectedTrack.id, selectedClipId || undefined);
        selectClip('');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [
    session,
    engine,
    run,
    save,
    help,
    settings,
    discard,
    selectedClipId,
    selectedTrack,
    beat,
    signatureEdit,
  ]);

  const startDrag = (
    event: ReactPointerEvent,
    clip: Clip,
    track: Track,
    mode: 'move' | 'trim',
  ) => {
    if (busyRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const element =
      event.currentTarget.closest<HTMLButtonElement>('.arrangement-clip')!;
    element.focus();
    element.setPointerCapture(event.pointerId);
    selectTrack(track.id);
    selectClip(clip.id);
    const next: Drag = {
      clipId: clip.id,
      trackId: track.id,
      targetId: track.id,
      x: event.clientX,
      y: event.clientY,
      start: clip.startBeat,
      duration:
        clip.kind === 'midi'
          ? beatsToSeconds(clip.lengthBeats ?? 4, project.tempo)
          : clip.durationSeconds,
      mode,
      moved: false,
    };
    dragRef.current = next;
    setDrag(next);
  };
  const moveDrag = (event: ReactPointerEvent, clip: Clip) => {
    const origin = dragRef.current;
    if (!origin || origin.clipId !== clip.id) return;
    const dx = event.clientX - origin.x;
    const next = {
      ...origin,
      moved:
        origin.moved || Math.abs(dx) + Math.abs(event.clientY - origin.y) > 4,
    };
    if (origin.mode === 'move') {
      next.start = Math.min(100000, snapBeat(clip.startBeat + dx / zoom, snap));
      const row = event.currentTarget.closest<HTMLElement>('[data-track-id]');
      if (row) {
        const targetRow = [
          ...document.querySelectorAll<HTMLElement>('[data-track-id]'),
        ].find((element) => {
          const rect = element.getBoundingClientRect();
          return event.clientY >= rect.top && event.clientY < rect.bottom;
        });
        const target = project.tracks.find(
          (t) => t.id === targetRow?.dataset.trackId,
        );
        if (target && (target.kind === 'midi') === (clip.kind === 'midi'))
          next.targetId = target.id;
      }
    } else {
      const endBeat = snapBeat(
        clipEndBeat(clip, project.tempo) + dx / zoom,
        snap,
      );
      const available =
        clip.kind === 'midi'
          ? beatsToSeconds(4096, project.tempo)
          : session.assets.get(clip.assetId)!.buffer.duration -
            clip.offsetSeconds;
      next.duration = Math.min(
        available,
        Math.max(
          clip.kind === 'midi'
            ? beatsToSeconds(
                Math.max(
                  0.0625,
                  ...(clip.notes ?? []).map((n) => n.start + n.length),
                ),
                project.tempo,
              )
            : Math.min(0.01, available),
          beatsToSeconds(endBeat - clip.startBeat, project.tempo),
        ),
      );
    }
    dragRef.current = next;
    setDrag(next);
  };
  const finishDrag = () => {
    const next = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!next?.moved) return;
    session.edit((previous) => {
      const original = previous.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === next.clipId);
      if (!original) return previous;
      const updated = {
        ...original,
        startBeat: next.start,
        ...(original.kind === 'midi'
          ? { lengthBeats: secondsToBeats(next.duration, previous.tempo) }
          : { durationSeconds: next.duration }),
      };
      return {
        ...previous,
        tracks: previous.tracks.map((track) => ({
          ...track,
          clips: [
            ...track.clips.filter((clip) => clip.id !== next.clipId),
            ...(track.id === next.targetId ? [updated] : []),
          ],
        })),
      };
    });
    selectTrack(next.targetId);
  };

  const createMidi = (trackId: string, at: number) => {
    void run('Creating MIDI clip', async () => {
      selectClip(session.addMidiClip(trackId, at));
      selectTrack(trackId);
      setRoll(true);
    });
  };
  const editActions = (track: Track, clip?: Clip): EditAction[] =>
    [
      ...(clip?.kind === 'midi'
        ? [
            {
              label: 'Open piano roll',
              action: () => {
                selectClip(clip.id);
                selectTrack(track.id);
                setRoll(true);
              },
            },
          ]
        : []),
      {
        label: clip ? 'Cut clip' : 'Cut track',
        action: () => session.copy(track.id, clip?.id, true),
      },
      {
        label: clip ? 'Copy clip' : 'Copy track',
        action: () => session.copy(track.id, clip?.id),
      },
      {
        label: 'Paste at playhead',
        action: () => {
          void run('Pasting', async () => {
            session.paste(track.id, beat);
          });
        },
      },
      {
        label: clip ? 'Duplicate clip' : 'Duplicate track',
        action: () => {
          void run('Duplicating', async () => {
            session.duplicate(track.id, clip?.id);
          });
        },
      },
      ...(!clip
        ? [
            {
              label:
                track.kind === 'midi'
                  ? 'Import WAV / MP3 to new track…'
                  : 'Import WAV / MP3 here…',
              action: () => chooseWavs(track.id),
            },
            ...(track.kind === 'midi'
              ? [
                  {
                    label: 'Add MIDI clip at playhead',
                    action: () => createMidi(track.id, snapBeat(beat, snap)),
                  },
                ]
              : []),
          ]
        : []),
      {
        label: clip ? 'Delete clip' : 'Delete track',
        destructive: true,
        action: () => session.remove(track.id, clip?.id),
      },
    ].map((action) => ({ ...action, disabled: !!busy }));
  const saveSignature = () => {
    if (!signatureEdit) return;
    if (
      signatureEdit.id &&
      markers.length >= 1024 &&
      !markers.some((m) => m.id === signatureEdit.id)
    ) {
      setError('Maximum 1024 signature changes.');
      return;
    }
    if (
      signatureEdit.id &&
      markers.some(
        (m) => m.id !== signatureEdit.id && m.beat === signatureEdit.beat,
      )
    ) {
      setError('A signature marker already exists at this position.');
      return;
    }
    session.edit((p) =>
      signatureEdit.id
        ? {
            ...p,
            signatureMarkers: [
              ...(p.signatureMarkers ?? []).filter(
                (m) => m.id !== signatureEdit.id,
              ),
              signatureEdit as SignatureMarker,
            ].sort((a, b) => a.beat - b.beat),
          }
        : { ...p, timeSignature: signatureEdit.signature },
    );
    setSignatureEdit(null);
  };

  return (
    <div className="daw-window">
      <header className="window-bar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width="27" height="27" />
          <strong>
            MNT<span>.</span>
          </strong>
          <span className="brand-tag">STUDIO</span>
        </div>
        <div className="project-title">
          <span
            className={`project-dot ${dirty ? 'unsaved' : ''}`}
            title={dirty ? 'Unsaved changes' : 'No unsaved edits'}
          />
          <input
            key={project.id + project.name}
            aria-label="Project name"
            defaultValue={project.name}
            maxLength={160}
            disabled={!!busy}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== project.name)
                session.edit((previous) => ({ ...previous, name }));
              else event.target.value = project.name;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          <ChevronDown size={12} />
        </div>
        <div className="window-actions">
          <IconButton
            label="New project"
            disabled={!!busy}
            onClick={() => fileAction('new')}
          >
            <FilePlus2 size={16} />
          </IconButton>
          <IconButton
            label="Open project (Ctrl+O)"
            disabled={!!busy}
            onClick={() => fileAction('open')}
          >
            <FolderOpen size={17} />
          </IconButton>
          <button
            className="button save-button"
            disabled={!!busy}
            onClick={save}
          >
            <Save size={15} />
            <span>Save project</span>
          </button>
          <span className="toolbar-divider" />
          <IconButton label="Audio settings" onClick={() => setSettings(true)}>
            <Settings2 size={17} />
          </IconButton>
          <IconButton
            label="Toggle fullscreen"
            onClick={() =>
              void run('Changing view', async () => {
                if (document.fullscreenElement) await document.exitFullscreen();
                else if (document.documentElement.requestFullscreen)
                  await document.documentElement.requestFullscreen();
              })
            }
          >
            <Maximize2 size={15} />
          </IconButton>
        </div>
      </header>

      <div className="transport-bar">
        <div className="transport-buttons">
          <IconButton
            label="Return to start"
            disabled={!!busy}
            onClick={() => seek(0)}
          >
            <SkipBack size={17} />
          </IconButton>
          <IconButton
            label="Stop (Esc)"
            disabled={!!busy}
            onClick={() => engine.stop()}
          >
            <Square size={14} fill="currentColor" />
          </IconButton>
          <IconButton
            label={playing ? 'Pause (Space)' : 'Play (Space)'}
            className="play-button"
            disabled={!!busy}
            onClick={() =>
              playing
                ? engine.pause()
                : void run('Starting audio', () => session.play())
            }
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </IconButton>
        </div>
        <div className="transport-time">
          <span className="musical-time">
            {signaturePosition(beat, project.timeSignature, markers)}
          </span>
          <span className="absolute-time">
            {formatTime(position, true)}
            <span>BARS · BEATS · TICKS</span>
          </span>
        </div>
        <div className="tempo-control">
          <NumberField
            label="TEMPO"
            value={project.tempo}
            min={20}
            max={300}
            step={0.1}
            disabled={!!busy}
            onChange={(tempo) =>
              session.edit((previous) => ({ ...previous, tempo }))
            }
          />
          <span>BPM</span>
        </div>
        <button
          className="signature"
          title="Edit project time signature"
          disabled={!!busy}
          onClick={() =>
            setSignatureEdit({ beat: 0, signature: project.timeSignature })
          }
        >
          <strong>{currentSignature.join(' / ')}</strong>
          <span>SIGNATURE</span>
        </button>
        <div className="transport-right">
          <span className={`engine-state ${playing ? 'running' : ''}`}>
            <span />
            {playing
              ? 'Playing'
              : audio.status === 'paused'
                ? 'Paused'
                : 'Stopped'}
          </span>
          <button className="engine-chip" onClick={() => setSettings(true)}>
            <Headphones size={13} />
            {audio.actualSampleRate
              ? `${audio.actualSampleRate / 1000} kHz`
              : `${audio.settings.sampleRate / 1000} kHz`}
            <ChevronDown size={11} />
          </button>
        </div>
      </div>

      <div className="arrangement-toolbar">
        <div className="view-title">
          <IconButton
            label={library ? 'Hide audio library' : 'Show audio library'}
            onClick={() => setLibrary(!library)}
          >
            {library ? (
              <PanelLeftClose size={16} />
            ) : (
              <PanelLeftOpen size={16} />
            )}
          </IconButton>
          <Layers3 size={15} />
          <h1>Arrangement</h1>
          <span className="view-count">{project.tracks.length} tracks</span>
        </div>
        <div className="edit-tools">
          <IconButton
            label="Undo (Ctrl+Z)"
            disabled={!canUndo || !!busy}
            onClick={() => session.undo()}
          >
            <Undo2 size={16} />
          </IconButton>
          <IconButton
            label="Redo (Ctrl+Shift+Z)"
            disabled={!canRedo || !!busy}
            onClick={() => session.redo()}
          >
            <Redo2 size={16} />
          </IconButton>
          <span className="toolbar-divider" />
          <button
            className={`snap-button ${snap ? 'enabled' : ''}`}
            aria-pressed={snap}
            onClick={() => setSnap(!snap)}
          >
            <Magnet size={14} />
            <span>Snap</span>
            <span className="snap-value">1 beat</span>
          </button>
          <span className="zoom-controls">
            <IconButton
              label="Zoom out"
              disabled={zoom <= 8}
              onClick={() => setZoom(Math.max(8, zoom / 1.4))}
            >
              <Minus size={14} />
            </IconButton>
            <span>{Math.round((zoom / 26) * 100)}%</span>
            <IconButton
              label="Zoom in"
              disabled={zoom >= 100}
              onClick={() => setZoom(Math.min(100, zoom * 1.4))}
            >
              <Plus size={14} />
            </IconButton>
          </span>
          <IconButton
            label="Add instrument track"
            disabled={!!busy}
            onClick={() => addTrack('midi')}
          >
            <Piano size={17} />
          </IconButton>
          <IconButton
            label="Import MIDI file"
            disabled={!!busy}
            onClick={() => midiInput.current?.click()}
          >
            <FilePlus2 size={16} />
          </IconButton>
          <button
            className="button add-track"
            disabled={!!busy}
            onClick={() => addTrack()}
          >
            <Plus size={14} />
            Track
          </button>
          <button
            className="button"
            disabled={!!busy}
            onClick={() => chooseWavs(selectedTrack?.id ?? null)}
          >
            <Upload size={14} />
            <span>Import audio</span>
          </button>
        </div>
      </div>

      {(error || message || busy) && (
        <div
          className={`notification ${error ? 'error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {busy && <LoaderCircle size={14} className="spin" />}
          <span>{error || busy || message}</span>
          {!busy && (
            <IconButton
              label="Dismiss notification"
              onClick={() => {
                setError('');
                setMessage('');
              }}
            >
              <X size={14} />
            </IconButton>
          )}
        </div>
      )}

      <main className={`workbench ${library ? '' : 'library-hidden'}`}>
        {library && (
          <aside className="library-panel" aria-label="Project audio library">
            <div className="panel-heading">
              <span>PROJECT</span>
              <ShieldCheck size={13} />
            </div>
            <div className="project-file">
              <div>
                <FolderOpen size={19} />
              </div>
              <span>
                <strong>{project.name}</strong>
                <small>Self-contained .mnt project</small>
              </span>
            </div>
            <div className="library-heading">
              <span>
                <ChevronDown size={12} />
                Audio files
              </span>
              <IconButton
                label="Import audio onto new tracks"
                disabled={!!busy}
                onClick={() => chooseWavs(null)}
              >
                <Plus size={14} />
              </IconButton>
            </div>
            <div className="asset-list">
              {project.assets.some((a) => a.kind !== 'soundfont') ? (
                project.assets
                  .filter((asset) => asset.kind !== 'soundfont')
                  .map((asset) => (
                    <button
                      className="asset-item"
                      draggable={!busy}
                      disabled={!!busy}
                      key={asset.id}
                      title={`${asset.name} — drag to a track or double-click to insert`}
                      onDragStart={(event) =>
                        event.dataTransfer.setData(
                          'application/x-mnt-asset',
                          asset.id,
                        )
                      }
                      onDoubleClick={() => {
                        if (selectedTrack)
                          insertAsset(asset.id, selectedTrack.id, beat);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && selectedTrack)
                          insertAsset(asset.id, selectedTrack.id, beat);
                      }}
                    >
                      <FileAudio2 size={15} />
                      <span>{asset.name}</span>
                      <small>
                        {formatTime(
                          session.assets.get(asset.id)?.buffer.duration ?? 0,
                        )}
                      </small>
                    </button>
                  ))
              ) : (
                <div className="library-empty">
                  <FileAudio2 size={25} strokeWidth={1.3} />
                  <p>Your sounds, in one place.</p>
                  <span>Import WAVs to build your project.</span>
                  <button disabled={!!busy} onClick={() => chooseWavs(null)}>
                    Import audio
                    <Plus size={12} />
                  </button>
                </div>
              )}
            </div>
            <div className="library-footer">
              <ShieldCheck size={14} />
              <span>
                Local audio. Yours to keep.
                <small>Media is included when you save.</small>
              </span>
            </div>
          </aside>
        )}

        <section className="arrangement" aria-label="Multitrack arrangement">
          <div className="arrangement-scroll" ref={scrollRef}>
            <div
              className="arrangement-content"
              style={
                {
                  width: HEADER_WIDTH + timelineWidth,
                  minHeight: '100%',
                  '--beat-width': `${zoom}px`,
                  '--bar-width': `${zoom * 4}px`,
                } as CSSProperties
              }
            >
              <div className="ruler-row">
                <div className="track-corner">
                  <span>TRACKS</span>
                  <button
                    className="marker-add"
                    title="Add time signature change at playhead"
                    disabled={!!busy}
                    onClick={() =>
                      setSignatureEdit({
                        id: crypto.randomUUID(),
                        beat: snapBeat(beat, snap),
                        signature: currentSignature,
                      })
                    }
                  >
                    + {currentSignature.join('/')}
                  </button>
                </div>
                <EditMenu
                  actions={[
                    {
                      label: 'Add time signature change here',
                      disabled: !!busy,
                      action: () =>
                        setSignatureEdit({
                          id: crypto.randomUUID(),
                          beat: snapBeat(beat, snap),
                          signature: currentSignature,
                        }),
                    },
                  ]}
                >
                  <button
                    className="bar-ruler"
                    aria-label="Seek on bar ruler"
                    style={{ width: timelineWidth }}
                    disabled={!!busy}
                    onPointerDown={(event) => {
                      if (busyRef.current) return;
                      const rect = event.currentTarget.getBoundingClientRect();
                      seek(snapBeat((event.clientX - rect.left) / zoom, snap));
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'ArrowRight' ||
                        event.key === 'ArrowLeft'
                      ) {
                        event.preventDefault();
                        seek(beat + (event.key === 'ArrowRight' ? 1 : -1));
                      }
                    }}
                  >
                    <div className="bar-numbers">
                      {bars.map((bar) => (
                        <span key={bar.bar} style={{ left: bar.beat * zoom }}>
                          {bar.bar}
                        </span>
                      ))}
                    </div>
                    <span className="ruler-beats">
                      {Array.from(
                        { length: Math.min(length, 4096) },
                        (_, index) => (
                          <i key={index} style={{ left: index * zoom }} />
                        ),
                      )}
                    </span>
                    <span
                      className="ruler-playhead"
                      aria-hidden="true"
                      style={{ left: beat * zoom }}
                    />
                  </button>
                </EditMenu>
                <div
                  className="signature-markers"
                  style={{ left: HEADER_WIDTH, width: timelineWidth }}
                >
                  {markers.map((marker) => (
                    <EditMenu
                      key={marker.id}
                      actions={[
                        {
                          label: 'Edit signature',
                          action: () => setSignatureEdit(marker),
                          disabled: !!busy,
                        },
                        {
                          label: 'Delete marker',
                          destructive: true,
                          disabled: !!busy,
                          action: () =>
                            session.edit((p) => ({
                              ...p,
                              signatureMarkers: (
                                p.signatureMarkers ?? []
                              ).filter((m) => m.id !== marker.id),
                            })),
                        },
                      ]}
                    >
                      <button
                        className="signature-marker"
                        style={{ left: marker.beat * zoom }}
                        title={`Time signature ${marker.signature.join('/')} at beat ${marker.beat}`}
                        disabled={!!busy}
                        onClick={() => setSignatureEdit(marker)}
                      >
                        {marker.signature.join('/')}
                      </button>
                    </EditMenu>
                  ))}
                </div>
              </div>
              {project.tracks.map((track, index) => (
                <EditMenu key={track.id} actions={() => editActions(track)}>
                  <div
                    className={`track-row ${track.id === selectedTrack?.id ? 'selected-track' : ''}`}
                    key={track.id}
                    data-track-id={track.id}
                    style={
                      {
                        '--track-color': track.color,
                        height: rowHeight(track),
                      } as CSSProperties
                    }
                  >
                    <div
                      className="track-header"
                      onContextMenu={() => {
                        selectTrack(track.id);
                        selectClip('');
                      }}
                    >
                      <div className="track-name-row">
                        <button
                          className="track-number"
                          aria-label={`Select ${track.name}`}
                          onClick={() => {
                            selectTrack(track.id);
                            selectClip('');
                          }}
                        >
                          {String(index + 1).padStart(2, '0')}
                        </button>
                        <input
                          key={track.id + track.name}
                          aria-label={`Track ${index + 1} name`}
                          defaultValue={track.name}
                          maxLength={160}
                          disabled={!!busy}
                          onFocus={() => {
                            selectTrack(track.id);
                            selectClip('');
                          }}
                          onBlur={(event) => {
                            const name = event.target.value.trim();
                            if (name && name !== track.name)
                              changeTrack(track.id, { name });
                            else event.target.value = track.name;
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter')
                              event.currentTarget.blur();
                          }}
                        />
                        {track.kind === 'midi' ? (
                          <Piano size={14} />
                        ) : (
                          <AudioLines size={14} />
                        )}
                      </div>
                      <div className="track-mixer-row">
                        <button
                          className={`track-switch ${track.muted ? 'mute-active' : ''}`}
                          title={`Mute ${track.name}`}
                          aria-label={`Mute ${track.name}`}
                          aria-pressed={track.muted}
                          disabled={!!busy}
                          onClick={() =>
                            changeTrack(track.id, { muted: !track.muted })
                          }
                        >
                          M
                        </button>
                        <button
                          className={`track-switch ${track.solo ? 'solo-active' : ''}`}
                          title={`Solo ${track.name}`}
                          aria-label={`Solo ${track.name}`}
                          aria-pressed={track.solo}
                          disabled={!!busy}
                          onClick={() =>
                            changeTrack(track.id, { solo: !track.solo })
                          }
                        >
                          S
                        </button>
                        <span className="track-output">
                          Master
                          <ChevronRight size={10} />
                        </span>
                        <button
                          className="track-gain"
                          title="Edit track volume in inspector"
                          onClick={() => {
                            selectTrack(track.id);
                            selectClip('');
                          }}
                        >
                          {track.volume > 0 ? '+' : ''}
                          {track.volume.toFixed(1)}
                          <small>dB</small>
                        </button>
                      </div>
                      <button
                        className="track-resize"
                        aria-label={`Resize ${track.name} height`}
                        tabIndex={0}
                        onPointerDown={(e) => {
                          if (busy || e.button !== 0) return;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          const value = {
                            id: track.id,
                            y: e.clientY,
                            initial: rowHeight(track),
                            height: rowHeight(track),
                          };
                          resizeRef.current = value;
                          setResize(value);
                        }}
                        onPointerMove={(e) => {
                          const old = resizeRef.current;
                          if (!old) return;
                          const value = {
                            ...old,
                            height: Math.round(
                              Math.max(
                                64,
                                Math.min(320, old.initial + e.clientY - old.y),
                              ),
                            ),
                          };
                          resizeRef.current = value;
                          setResize(value);
                        }}
                        onPointerUp={() => {
                          if (resizeRef.current)
                            changeTrack(track.id, {
                              height: resizeRef.current.height,
                            });
                          resizeRef.current = null;
                          setResize(null);
                        }}
                        onPointerCancel={() => {
                          resizeRef.current = null;
                          setResize(null);
                        }}
                        onKeyDown={(e) => {
                          if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
                            e.preventDefault();
                            changeTrack(track.id, {
                              height: Math.max(
                                64,
                                Math.min(
                                  320,
                                  rowHeight(track) +
                                    (e.key === 'ArrowDown' ? 8 : -8),
                                ),
                              ),
                            });
                          }
                        }}
                      />
                    </div>
                    <div
                      className={`track-lane ${track.muted || (anySolo && !track.solo) ? 'lane-muted' : ''}`}
                      style={{ width: timelineWidth }}
                      onPointerDown={(event) => {
                        if (
                          event.target !== event.currentTarget ||
                          busyRef.current
                        )
                          return;
                        selectTrack(track.id);
                        selectClip('');
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        seek(
                          snapBeat((event.clientX - rect.left) / zoom, snap),
                        );
                      }}
                      onDoubleClick={(event) => {
                        if (
                          track.kind === 'midi' &&
                          event.target === event.currentTarget
                        )
                          createMidi(
                            track.id,
                            snapBeat(
                              (event.clientX -
                                event.currentTarget.getBoundingClientRect()
                                  .left) /
                                zoom,
                              snap,
                            ),
                          );
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (busyRef.current) return;
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        const at = snapBeat(
                          (event.clientX - rect.left) / zoom,
                          snap,
                        );
                        const assetId = event.dataTransfer.getData(
                          'application/x-mnt-asset',
                        );
                        if (assetId) insertAsset(assetId, track.id, at);
                        else
                          importWavs(Array.from(event.dataTransfer.files), {
                            trackId: track.id,
                            beat: at,
                          });
                      }}
                    >
                      {track.clips.map((clip) => {
                        const asset = session.assets.get(clip.assetId);
                        const moving = drag?.clipId === clip.id ? drag : null;
                        const start = moving?.start ?? clip.startBeat;
                        const duration =
                          moving?.duration ??
                          (clip.kind === 'midi'
                            ? beatsToSeconds(
                                clip.lengthBeats ?? 4,
                                project.tempo,
                              )
                            : clip.durationSeconds);
                        const rowDelta = moving
                          ? rowTop(moving.targetId) - rowTop(track.id)
                          : 0;
                        return (
                          <EditMenu
                            key={clip.id}
                            actions={() => editActions(track, clip)}
                          >
                            <button
                              className={`arrangement-clip ${selectedClipId === clip.id ? 'selected-clip' : ''} ${moving ? 'dragging-clip' : ''}`}
                              style={{
                                left: start * zoom,
                                height: rowHeight(track) - 18,
                                width: Math.max(
                                  12,
                                  secondsToBeats(duration, project.tempo) *
                                    zoom,
                                ),
                                transform: rowDelta
                                  ? `translateY(${rowDelta}px)`
                                  : undefined,
                              }}
                              aria-label={`${clip.name}, position ${signaturePosition(start, project.timeSignature, markers)}, ${duration.toFixed(2)} seconds`}
                              aria-pressed={selectedClipId === clip.id}
                              disabled={!!busy}
                              onDoubleClick={() => {
                                if (clip.kind === 'midi') setRoll(true);
                              }}
                              onContextMenu={() => {
                                selectClip(clip.id);
                                selectTrack(track.id);
                              }}
                              onClick={() => {
                                selectClip(clip.id);
                                selectTrack(track.id);
                              }}
                              onPointerDown={(event) =>
                                startDrag(event, clip, track, 'move')
                              }
                              onPointerMove={(event) => moveDrag(event, clip)}
                              onPointerUp={finishDrag}
                              onPointerCancel={() => {
                                dragRef.current = null;
                                setDrag(null);
                              }}
                              onKeyDown={(event) => {
                                if (
                                  event.key === 'ArrowLeft' ||
                                  event.key === 'ArrowRight'
                                ) {
                                  event.preventDefault();
                                  changeClip(clip.id, {
                                    startBeat: Math.max(
                                      0,
                                      clip.startBeat +
                                        (event.key === 'ArrowRight' ? 1 : -1) *
                                          (snap ? 1 : 0.1),
                                    ),
                                  });
                                }
                              }}
                            >
                              <span className="clip-title">
                                {clip.kind === 'midi' ? (
                                  <Piano size={11} />
                                ) : (
                                  <AudioLines size={11} />
                                )}
                                <span>{clip.name}</span>
                              </span>
                              {clip.kind === 'midi' && (
                                <svg
                                  className="clip-midi"
                                  viewBox="0 0 100 48"
                                  preserveAspectRatio="none"
                                  aria-hidden="true"
                                >
                                  {(clip.notes ?? []).map((n) => (
                                    <rect
                                      key={n.id}
                                      x={
                                        (n.start / (clip.lengthBeats ?? 4)) *
                                        100
                                      }
                                      y={((127 - n.pitch) / 127) * 42}
                                      width={Math.max(
                                        0.3,
                                        (n.length / (clip.lengthBeats ?? 4)) *
                                          100,
                                      )}
                                      height="1.6"
                                    />
                                  ))}
                                </svg>
                              )}
                              {asset && (
                                <ClipWave
                                  buffer={asset.buffer}
                                  offset={clip.offsetSeconds}
                                  duration={duration}
                                />
                              )}
                              <span
                                className="clip-trim"
                                title="Drag to trim clip end"
                                onPointerDown={(event) =>
                                  startDrag(event, clip, track, 'trim')
                                }
                              >
                                <GripVertical size={12} />
                              </span>
                            </button>
                          </EditMenu>
                        );
                      })}
                      {!track.clips.length && (
                        <span className="lane-hint">
                          {track.kind === 'midi'
                            ? 'Double-click to create a MIDI clip'
                            : 'Drop WAV / MP3, or right-click to import'}{' '}
                          <Upload size={12} />
                        </span>
                      )}
                    </div>
                  </div>
                </EditMenu>
              ))}
              <div className="track-add-row">
                <button disabled={!!busy} onClick={() => addTrack()}>
                  <Plus size={14} />
                  Add audio track
                </button>
                <div
                  className="timeline-floor"
                  style={{ width: timelineWidth }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!busyRef.current && event.dataTransfer.files.length)
                      importWavs(Array.from(event.dataTransfer.files), {
                        trackId: null,
                        beat: 0,
                      });
                  }}
                >
                  <span>
                    <AudioLines size={24} strokeWidth={1} />
                    Drop WAVs to create new tracks
                  </span>
                </div>
              </div>
              <div
                className="signature-grid"
                aria-hidden="true"
                style={{
                  left: HEADER_WIDTH,
                  height: project.tracks.reduce(
                    (sum, t) => sum + rowHeight(t),
                    0,
                  ),
                  width: timelineWidth,
                }}
              >
                {bars.map((b) => (
                  <i key={b.bar} style={{ left: b.beat * zoom }} />
                ))}
              </div>
              <div
                className="timeline-playhead"
                aria-hidden="true"
                style={{
                  left: HEADER_WIDTH + beat * zoom,
                  height: project.tracks.reduce(
                    (sum, t) => sum + rowHeight(t),
                    0,
                  ),
                }}
              >
                <span />
              </div>
            </div>
          </div>
          <div className="timeline-footer">
            <span id="timeline-position-label">POSITION</span>
            <Slider
              aria-labelledby="timeline-position-label"
              value={[beat]}
              min={0}
              max={length}
              step={snap ? 1 : 0.01}
              disabled={!!busy}
              onValueChange={(value) =>
                seek(Array.isArray(value) ? value[0] : value)
              }
            />
            <span>
              {Number(
                signaturePosition(
                  Math.max(0, length - 0.0001),
                  project.timeSignature,
                  markers,
                ).split('.')[0],
              )}{' '}
              bars
            </span>
          </div>
          {roll && selectedClip?.kind === 'midi' && selectedTrack && (
            <PianoRoll
              key={selectedClip.id}
              clip={selectedClip}
              track={selectedTrack}
              session={session}
              close={() => setRoll(false)}
              report={report}
              disabled={!!busy}
            />
          )}
        </section>

        <aside className="clip-inspector" aria-label="Clip and track inspector">
          <div className="panel-heading">
            <span>INSPECTOR</span>
            <SlidersHorizontal size={13} />
          </div>
          <div className="inspector-selection">
            <div
              className="selection-icon"
              style={{ color: selectedTrack?.color }}
            >
              <AudioLines size={19} />
            </div>
            <div>
              <small>
                {selectedClip
                  ? selectedClip.kind === 'midi'
                    ? 'MIDI CLIP'
                    : 'AUDIO CLIP'
                  : selectedTrack?.kind === 'midi'
                    ? 'INSTRUMENT TRACK'
                    : 'AUDIO TRACK'}
              </small>
              <strong>
                {selectedClip?.name ??
                  selectedTrack?.name ??
                  'No track selected'}
              </strong>
            </div>
          </div>
          {selectedClip && selectedTrack && selectedAsset ? (
            <div className="clip-properties">
              <label className="text-field">
                <span>Clip name</span>
                <input
                  key={selectedClip.id + selectedClip.name}
                  defaultValue={selectedClip.name}
                  aria-label="Clip name"
                  maxLength={160}
                  disabled={!!busy}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== selectedClip.name)
                      changeClip(selectedClip.id, { name });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </label>
              <NumberField
                label="Start · beats"
                value={selectedClip.startBeat}
                min={0}
                max={100000}
                step={snap ? 1 : 0.1}
                disabled={!!busy}
                onChange={(startBeat) =>
                  changeClip(selectedClip.id, { startBeat })
                }
              />
              <NumberField
                label="Source offset · sec"
                value={selectedClip.offsetSeconds}
                min={0}
                max={Math.max(0, selectedAsset.buffer.duration - 0.01)}
                step={0.01}
                disabled={!!busy}
                onChange={(offsetSeconds) =>
                  changeClip(selectedClip.id, {
                    offsetSeconds,
                    durationSeconds: Math.min(
                      selectedClip.durationSeconds,
                      selectedAsset.buffer.duration - offsetSeconds,
                    ),
                  })
                }
              />
              <NumberField
                label="Duration · sec"
                value={selectedClip.durationSeconds}
                min={Math.min(0.01, selectedAsset.buffer.duration)}
                max={selectedAsset.buffer.duration - selectedClip.offsetSeconds}
                step={0.01}
                disabled={!!busy}
                onChange={(durationSeconds) =>
                  changeClip(selectedClip.id, { durationSeconds })
                }
              />
              <Choice
                id="clip-track"
                label="Track"
                value={selectedTrack.id}
                options={project.tracks
                  .filter((t) => t.kind !== 'midi')
                  .map((track) => ({
                    value: track.id,
                    label: track.name,
                  }))}
                disabled={!!busy}
                onChange={(id) => {
                  session.edit((previous) => ({
                    ...previous,
                    tracks: previous.tracks.map((track) => ({
                      ...track,
                      clips: [
                        ...track.clips.filter(
                          (clip) => clip.id !== selectedClip.id,
                        ),
                        ...(track.id === id ? [selectedClip] : []),
                      ],
                    })),
                  }));
                  selectTrack(id);
                }}
              />
              <div className="clip-actions">
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={duplicateClip}
                >
                  <Copy size={13} />
                  Duplicate
                </button>
                <IconButton
                  label="Delete selected clip"
                  disabled={!!busy}
                  onClick={deleteClip}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <div className="source-info">
                <FileAudio2 size={13} />
                <span>
                  {selectedAsset.wav.sampleRate / 1000} kHz ·{' '}
                  {selectedAsset.wav.bitDepth
                    ? `${selectedAsset.wav.bitDepth}-bit`
                    : 'MP3'}
                  <small>
                    {selectedAsset.wav.channels === 1
                      ? 'Mono'
                      : `${selectedAsset.wav.channels} channels`}{' '}
                    · Original speed
                  </small>
                </span>
              </div>
            </div>
          ) : selectedTrack ? (
            <div className="track-properties">
              <NumberField
                label="Track volume · dB"
                value={selectedTrack.volume}
                min={-60}
                max={6}
                step={0.1}
                disabled={!!busy}
                onChange={(volume) => changeTrack(selectedTrack.id, { volume })}
              />
              <div className="property-row">
                <span>Clips</span>
                <b>{selectedTrack.clips.length}</b>
              </div>
              <div className="property-row">
                <span>Output</span>
                <b>Master</b>
              </div>
              <p className="inspector-note">
                {selectedTrack.kind === 'midi'
                  ? 'Double-click a MIDI clip to draw notes or capture your keyboard.'
                  : 'Select a clip to edit its position, source offset, and duration.'}
              </p>
              <button
                className="button"
                disabled={!!busy}
                onClick={() =>
                  selectedTrack.kind === 'midi'
                    ? createMidi(selectedTrack.id, snapBeat(beat, snap))
                    : chooseWavs(selectedTrack.id)
                }
              >
                <Upload size={13} />
                {selectedTrack.kind === 'midi'
                  ? 'Create MIDI clip'
                  : 'Import to track'}
              </button>
              <button
                className="delete-track"
                disabled={!!busy}
                onClick={deleteTrack}
              >
                <Trash2 size={12} />
                Remove track
              </button>
            </div>
          ) : (
            <div className="inspector-note">
              Add a track to begin your arrangement.
            </div>
          )}
          {selectedTrack?.kind === 'midi' && (
            <>
              <div className="midi-clip-properties">
                {selectedClip?.kind === 'midi' && (
                  <>
                    <label className="text-field">
                      <span>Clip name</span>
                      <input
                        key={selectedClip.id + selectedClip.name}
                        defaultValue={selectedClip.name}
                        maxLength={160}
                        disabled={!!busy}
                        onBlur={(e) => {
                          if (e.target.value.trim())
                            changeClip(selectedClip.id, {
                              name: e.target.value.trim(),
                            });
                        }}
                      />
                    </label>
                    <NumberField
                      label="Start · beats"
                      value={selectedClip.startBeat}
                      min={0}
                      max={100000}
                      step={snap ? 1 : 0.1}
                      disabled={!!busy}
                      onChange={(startBeat) =>
                        changeClip(selectedClip.id, { startBeat })
                      }
                    />
                    <NumberField
                      label="Length · beats"
                      value={selectedClip.lengthBeats ?? 4}
                      min={Math.max(
                        0.0625,
                        ...(selectedClip.notes ?? []).map(
                          (n) => n.start + n.length,
                        ),
                      )}
                      max={4096}
                      step={0.25}
                      disabled={!!busy}
                      onChange={(lengthBeats) =>
                        changeClip(selectedClip.id, { lengthBeats })
                      }
                    />
                    <button className="button" onClick={() => setRoll(!roll)}>
                      <Piano size={14} />
                      {roll ? 'Hide' : 'Open'} piano roll
                    </button>
                  </>
                )}
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    createMidi(selectedTrack.id, snapBeat(beat, snap))
                  }
                >
                  <Plus size={13} />
                  MIDI clip
                </button>
              </div>
              <InstrumentPanel
                key={selectedTrack.id}
                track={selectedTrack}
                session={session}
                busy={!!busy}
                run={run}
              />
            </>
          )}
          <div className="inspector-spacer" />
          <div className="master-section">
            <div className="master-title">
              <Volume2 size={14} />
              <strong>Master</strong>
              <span>
                {audio.volume > 0 ? '+' : ''}
                {audio.volume.toFixed(1)} dB
              </span>
            </div>
            <LevelMeter
              levels={levels}
              clipped={clipped}
              reset={() => setClipped(false)}
            />
            <div className="master-fader">
              <IconButton
                label={project.master.muted ? 'Unmute master' : 'Mute master'}
                aria-pressed={project.master.muted}
                className={project.master.muted ? 'muted' : ''}
                disabled={!!busy}
                onClick={() =>
                  session.edit((previous) => ({
                    ...previous,
                    master: {
                      ...previous.master,
                      muted: !previous.master.muted,
                    },
                  }))
                }
              >
                {project.master.muted ? (
                  <VolumeX size={16} />
                ) : (
                  <Volume2 size={16} />
                )}
              </IconButton>
              <span id="master-volume-label" className="sr-only">
                Master volume in decibels
              </span>
              <Slider
                key={project.master.volume}
                aria-labelledby="master-volume-label"
                defaultValue={[project.master.volume]}
                min={-60}
                max={6}
                step={0.1}
                disabled={!!busy}
                onValueChange={(value) =>
                  engine.setVolume(Array.isArray(value) ? value[0] : value)
                }
                onValueCommitted={(value) => {
                  const volume = Array.isArray(value) ? value[0] : value;
                  if (volume !== project.master.volume)
                    session.edit((previous) => ({
                      ...previous,
                      master: { ...previous.master, volume },
                    }));
                }}
              />
            </div>
          </div>
        </aside>
      </main>

      <footer className="statusbar">
        <span className="status-project">
          <span className={`status-dot ${dirty ? 'unsaved' : ''}`} />
          {dirty ? 'Unsaved changes' : 'Project ready'}
          <span className="status-divider">/</span>
          {project.tracks.length} tracks · {totalClips} clips
        </span>
        <span className="status-hint">
          Drag to move · Arrow keys to nudge · Delete to remove
        </span>
        <button onClick={() => setHelp(true)}>
          <Keyboard size={14} />
          Shortcuts
        </button>
        <span className="version">MNT / MIDI 03</span>
      </footer>
      <input
        type="file"
        hidden
        multiple
        ref={wavInput}
        accept=".wav,.mp3,.mid,.midi,audio/wav,audio/mpeg"
        aria-label="Import WAV files"
        onChange={(event) => {
          importWavs(
            Array.from(event.target.files ?? []),
            importTarget.current,
          );
          event.target.value = '';
        }}
      />
      <input
        type="file"
        hidden
        ref={projectInput}
        accept=".mnt,application/json"
        aria-label="Open MNT project file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            void run('Opening project', async () => {
              await session.open(file);
              selectClip('');
              selectTrack(session.getSnapshot().project.tracks[0]?.id ?? '');
              setClipped(false);
              setMessage('Project opened.');
              if (scrollRef.current) scrollRef.current.scrollLeft = 0;
            });
          event.target.value = '';
        }}
      />
      <input
        type="file"
        hidden
        ref={midiInput}
        accept=".mid,.midi"
        aria-label="Import MIDI file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            void run('Importing MIDI', async () => {
              selectClip(await session.importMidi(file, snapBeat(beat, snap)));
              setRoll(true);
            });
          event.target.value = '';
        }}
      />
      <Dialog
        open={signatureEdit !== null}
        onOpenChange={(open) => {
          if (!open) setSignatureEdit(null);
        }}
      >
        <DialogContent className="confirm-dialog">
          <DialogTitle>
            {signatureEdit?.id
              ? 'Time signature change'
              : 'Project time signature'}
          </DialogTitle>
          <DialogDescription>
            Markers start a new bar at their position. Existing clips keep their
            quarter-note beat positions.
          </DialogDescription>
          {signatureEdit && (
            <>
              <div className="signature-fields">
                <NumberField
                  label="Numerator"
                  value={signatureEdit.signature[0]}
                  min={1}
                  max={32}
                  onChange={(n) =>
                    setSignatureEdit({
                      ...signatureEdit,
                      signature: [Math.round(n), signatureEdit.signature[1]],
                    })
                  }
                />
                <Choice
                  id="signature-denominator"
                  label="Denominator"
                  value={String(signatureEdit.signature[1])}
                  options={[1, 2, 4, 8, 16, 32].map((n) => ({
                    value: String(n),
                    label: String(n),
                  }))}
                  onChange={(d) =>
                    setSignatureEdit({
                      ...signatureEdit,
                      signature: [signatureEdit.signature[0], Number(d)],
                    })
                  }
                />
              </div>
              {signatureEdit.id && (
                <NumberField
                  label="Position · quarter-note beats"
                  value={signatureEdit.beat}
                  min={0}
                  max={100000}
                  step={0.25}
                  onChange={(beat) =>
                    setSignatureEdit({ ...signatureEdit, beat })
                  }
                />
              )}
              {signatureEdit.id &&
                markers.some(
                  (m) =>
                    m.id !== signatureEdit.id && m.beat === signatureEdit.beat,
                ) && (
                  <p className="field-note" role="alert">
                    A marker already exists at this position. Choose another
                    beat or edit that marker.
                  </p>
                )}
              <button
                className="button primary"
                disabled={
                  !!signatureEdit.id &&
                  markers.some(
                    (m) =>
                      m.id !== signatureEdit.id &&
                      m.beat === signatureEdit.beat,
                  )
                }
                onClick={saveSignature}
              >
                Apply signature
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <AudioSettings
        engine={engine}
        open={settings}
        onOpenChange={setSettings}
        busy={busy}
        run={run}
        report={report}
      />
      <Dialog
        open={discard !== null}
        onOpenChange={(open) => {
          if (!open) setDiscard(null);
        }}
      >
        <DialogContent className="confirm-dialog">
          <DialogTitle>Keep your current project?</DialogTitle>
          <DialogDescription>
            You have changes that have not been downloaded. Save a project copy
            first, or discard the changes to continue.
          </DialogDescription>
          <div className="dialog-actions">
            <button className="button" onClick={() => setDiscard(null)}>
              Keep editing
            </button>
            <button
              className="button danger"
              onClick={() => {
                const action = discard;
                setDiscard(null);
                if (action) performFileAction(action);
              }}
            >
              Discard changes
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="help-dialog">
          <DialogTitle>At your fingertips.</DialogTitle>
          <DialogDescription>
            Your project workspace, without the extra clicks.
          </DialogDescription>
          <div className="shortcut-list">
            <span>
              Play / pause<kbd>Space</kbd>
            </span>
            <span>
              Stop and return to start<kbd>Esc</kbd>
            </span>
            <span>
              Save project copy<kbd>Ctrl / ⌘ S</kbd>
            </span>
            <span>
              Open project<kbd>Ctrl / ⌘ O</kbd>
            </span>
            <span>
              Undo / redo<kbd>Ctrl / ⌘ Z · Shift Z</kbd>
            </span>
            <span>
              Nudge focused clip<kbd>← →</kbd>
            </span>
            <span>
              Delete selected clip<kbd>Delete</kbd>
            </span>
          </div>
          <p className="field-note">
            Drag clips between tracks. Drag a clip’s right edge to trim it. Use
            the inspector for precise timing. Double-click a library file to
            insert it at the playhead.
          </p>
          <p className="field-note">
            Projects embed the original WAVs. Tempo moves clip starts on the
            beat grid; audio keeps its original speed. MIDI follows project
            tempo; signature changes are available on the ruler.
          </p>
          <button className="button primary" onClick={() => setHelp(false)}>
            Back to the project
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
