'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  FileAudio2,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  SkipBack,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AudioEngine } from '@/lib/audio-engine';
import { formatTime, gainToDb, waveformPeaks } from '@/lib/audio-utils';

function IconButton({
  label,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-button ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Choice({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="setting-field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <Select
        value={value}
        onValueChange={(value) => {
          if (value !== null) onChange(value);
        }}
        items={options}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          aria-labelledby={`${id}-label`}
          className="setting-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Waveform({
  buffer,
  position,
  onSeek,
}: {
  buffer: AudioBuffer;
  position: number;
  onSeek: (time: number) => void;
}) {
  const paths = useMemo(
    () =>
      Array.from(
        { length: Math.min(buffer.numberOfChannels, 2) },
        (_, channel) =>
          waveformPeaks(buffer.getChannelData(channel))
            .map(
              ([min, max], index) =>
                `M${index + 0.5},${50 - max * 44}V${50 - min * 44}`,
            )
            .join(' '),
      ),
    [buffer],
  );
  const progress = Math.min(100, (position / buffer.duration) * 100);
  return (
    <div
      className="waveform"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * buffer.duration);
      }}
    >
      <div className="waveform-played" style={{ width: `${progress}%` }} />
      {paths.map((path, channel) => (
        <div className="wave-channel" key={channel}>
          <span>{paths.length === 1 ? 'MONO' : channel === 0 ? 'L' : 'R'}</span>
          <svg
            viewBox="0 0 720 100"
            preserveAspectRatio="none"
            aria-label={`${channel === 0 ? 'Left' : 'Right'} channel waveform`}
          >
            <path d="M0 50H720" className="wave-baseline" />
            <path d={path} className="wave-path" />
          </svg>
        </div>
      ))}
      <div className="playhead" style={{ left: `${progress}%` }}>
        <span />
      </div>
    </div>
  );
}

function Meter({
  levels,
  clipped,
  onReset,
}: {
  levels: number[];
  clipped: boolean;
  onReset: () => void;
}) {
  const dbs = levels.map(gainToDb);
  const peak = Math.max(...dbs);
  return (
    <div className="meter-section">
      <div className="meter-caption">
        <span>OUTPUT LEVEL</span>
        <button
          className={`peak-readout ${clipped ? 'clipped' : ''}`}
          onClick={onReset}
          title="Reset clipping indicator"
          aria-label="Reset clipping indicator"
        >
          {clipped
            ? 'CLIP'
            : Number.isFinite(peak) && peak > -60
              ? `${peak.toFixed(1)} dB`
              : '−∞ dB'}
        </button>
      </div>
      <div className="stereo-meter">
        {dbs.map((db, index) => (
          <div className="meter-row" key={index}>
            <span>{index ? 'R' : 'L'}</span>
            <meter
              className="sr-only"
              aria-label={`${index ? 'Right' : 'Left'} output level`}
              min={-60}
              max={0}
              value={Math.max(-60, Math.min(0, db))}
            />
            <div className="meter-track" aria-hidden="true">
              <div className="meter-color" />
              <div
                className="meter-mask"
                style={{
                  width: `${100 - Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="meter-scale">
        <span>−60</span>
        <span>−36</span>
        <span>−12</span>
        <span>0</span>
      </div>
    </div>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return 'Device access was not allowed. You can keep using your system output or try connecting again.';
    if (error.name === 'NotFoundError')
      return 'That audio device is no longer available. Choose another output.';
    if (error.name === 'NotSupportedError')
      return 'This audio setting is not supported by your browser or device. Try 44.1 or 48 kHz.';
  }
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

export default function Home() {
  const [engine] = useState(() => new AudioEngine());
  const audio = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [position, setPosition] = useState(0);
  const [levels, setLevels] = useState<number[]>([0, 0]);
  const [clipped, setClipped] = useState(false);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [draft, setDraft] = useState(audio.settings);
  const [dragging, setDragging] = useState(false);
  const [help, setHelp] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const duration = audio.buffer?.duration ?? 0;
  const playing = audio.status === 'playing';
  const deviceSupported = engine.canSelectDevice;
  const dirty =
    draft.sampleRate !== audio.settings.sampleRate ||
    draft.bufferSize !== audio.settings.bufferSize;

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(label);
      setError('');
      setNotice('');
      try {
        await action();
      } catch (error) {
        setError(errorMessage(error));
      } finally {
        busyRef.current = false;
        setBusy('');
      }
    },
    [],
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) =>
        device.kind === 'audiooutput' &&
        device.deviceId &&
        device.deviceId !== 'default',
    );
    setDevices(outputs);
    return outputs;
  }, []);

  useEffect(() => {
    void Promise.resolve()
      .then(refreshDevices)
      .catch(() => {});
    const changed = () => {
      void refreshDevices()
        .then(async (outputs) => {
          const selected = engine.getSnapshot().deviceId;
          if (
            selected &&
            !outputs.some((device) => device.deviceId === selected)
          ) {
            await engine.setDevice('');
            setNotice('Output disconnected. Using your system default.');
          }
        })
        .catch((error) => setError(errorMessage(error)));
    };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    return () =>
      navigator.mediaDevices?.removeEventListener('devicechange', changed);
  }, [engine, refreshDevices]);

  useEffect(() => {
    let frame = 0,
      previous = 0;
    const tick = (time: number) => {
      if (time - previous > 32) {
        setPosition(engine.position);
        const next = engine.readLevels();
        setLevels((old) => {
          const settled = next.map((value, index) => {
            const level = Math.max(value, old[index] * 0.82);
            return level < 0.0001 ? 0 : level;
          });
          return settled.every((level, index) => level === old[index])
            ? old
            : settled;
        });
        if (next.some((value) => value >= 1)) setClipped(true);
        previous = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'input, textarea, select, button, [role="slider"], [role="combobox"], [role="dialog"], [contenteditable="true"]',
        ) ||
        help ||
        busyRef.current
      )
        return;
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        if (engine.getSnapshot().status === 'playing') engine.pause();
        else void run('Starting audio', () => engine.play());
      }
      if (event.code === 'Escape') engine.stop();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [engine, help, run]);

  const importFile = (file?: File) => {
    if (file)
      void run('Loading WAV', async () => {
        await engine.load(file);
        setClipped(false);
      });
  };
  const connectDevices = () =>
    void run('Connecting devices', async () => {
      const media = navigator.mediaDevices as MediaDevices & {
        selectAudioOutput?: () => Promise<MediaDeviceInfo>;
      };
      if (!media) throw new Error('Device access requires HTTPS or localhost.');
      if (media.selectAudioOutput) {
        const selected = await media.selectAudioOutput();
        await engine.setDevice(selected.deviceId);
        const outputs = await refreshDevices();
        if (!outputs.some((device) => device.deviceId === selected.deviceId))
          setDevices([...outputs, selected]);
      } else {
        const stream = await media.getUserMedia({ audio: true });
        // Permission reveals speaker names; microphone audio is never connected or recorded.
        stream.getTracks().forEach((track) => track.stop());
        await refreshDevices();
        setNotice('Available outputs refreshed. Choose your device below.');
      }
    });
  const outputName = audio.deviceId
    ? devices.find((device) => device.deviceId === audio.deviceId)?.label ||
      'Selected output'
    : 'System default';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width="34" height="34" />
          <span>
            MNT<span className="brand-dot">.</span>
          </span>
          <span className="brand-divider" />
          <span className="brand-caption">Audio workspace</span>
        </div>
        <div className="transport" aria-label="Playback controls">
          <IconButton
            label="Return to start"
            disabled={!audio.buffer || !!busy}
            onClick={() => engine.seek(0)}
          >
            <SkipBack size={17} />
          </IconButton>
          <IconButton
            label="Stop (Esc)"
            disabled={!audio.buffer || !!busy}
            onClick={() => engine.stop()}
          >
            <Square size={15} fill="currentColor" />
          </IconButton>
          <IconButton
            label={playing ? 'Pause (Space)' : 'Play (Space)'}
            className={`play-button ${playing ? 'is-playing' : ''}`}
            disabled={!audio.buffer || !!busy}
            onClick={() =>
              playing
                ? engine.pause()
                : void run('Starting audio', () => engine.play())
            }
          >
            {playing ? (
              <Pause size={19} fill="currentColor" />
            ) : (
              <Play size={19} fill="currentColor" />
            )}
          </IconButton>
          <div className="transport-clock">
            <span>{formatTime(position, true)}</span>
            <small>{audio.status}</small>
          </div>
        </div>
        <div className="header-actions">
          <IconButton label="Workspace help" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
          </IconButton>
          <button
            className="button import-button"
            disabled={!!busy}
            onClick={() => fileInput.current?.click()}
          >
            <Plus size={17} />
            <span>Import WAV</span>
          </button>
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept=".wav,audio/wav,audio/x-wav,audio/wave"
        hidden
        aria-label="Choose WAV file"
        onChange={(event) => {
          importFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <main className="workspace">
        <section className="editor">
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">
                WORKSPACE <span>/</span> 01
              </div>
              <h1>
                {audio.fileName
                  ? audio.fileName.replace(/\.wav$/i, '')
                  : 'Untitled session'}
              </h1>
            </div>
            <span className={`status-badge ${playing ? 'active' : ''}`}>
              <span />
              {playing
                ? 'Playing'
                : audio.buffer
                  ? 'Ready to play'
                  : 'Ready when you are'}
            </span>
          </div>
          {(error || notice) && (
            <div
              className={`message ${error ? 'error' : ''}`}
              role={error ? 'alert' : 'status'}
            >
              <span>{error || notice}</span>
              <IconButton
                label="Dismiss message"
                onClick={() => {
                  setError('');
                  setNotice('');
                }}
              >
                <X size={16} />
              </IconButton>
            </div>
          )}
          <div
            className={`audio-panel ${dragging ? 'dragging' : ''}`}
            aria-label="Audio file workspace"
            aria-busy={!!busy}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length !== 1)
                setError('Import one WAV file at a time.');
              else importFile(event.dataTransfer.files[0]);
            }}
          >
            <div className="panel-toolbar">
              <span>
                <AudioLines size={16} /> AUDIO{' '}
                {audio.buffer && <span className="count-badge">01</span>}
              </span>
              <span className="toolbar-right">
                {audio.wav
                  ? `${audio.wav.channels === 1 ? 'Mono' : audio.wav.channels === 2 ? 'Stereo' : `${audio.wav.channels} channels`} · ${audio.wav.bitDepth}-bit`
                  : 'WAV'}
              </span>
            </div>
            <div className="timeline-ruler">
              {Array.from({ length: 7 }, (_, index) => (
                <span key={index}>
                  {formatTime(((duration || 30) * index) / 6)}
                </span>
              ))}
            </div>
            <div className="audio-canvas">
              {audio.buffer ? (
                <>
                  <div className="clip-label">
                    <FileAudio2 size={14} />
                    <span>{audio.fileName}</span>
                    <span>{formatTime(duration, true)}</span>
                  </div>
                  <Waveform
                    buffer={audio.buffer}
                    position={position}
                    onSeek={(seconds) => {
                      if (!busyRef.current) engine.seek(seconds);
                    }}
                  />
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-audio-icon">
                    <AudioLines size={34} strokeWidth={1.25} />
                  </div>
                  <h2>Your next sound starts here.</h2>
                  <p>Drop a WAV file into your workspace.</p>
                  <button
                    className="button primary-button"
                    disabled={!!busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    {busy === 'Loading WAV' ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <ArrowDownToLine size={16} />
                    )}
                    Choose a file
                  </button>
                  <span className="file-limit">WAV audio · up to 150 MB</span>
                </div>
              )}
              {dragging && (
                <div className="drop-overlay">
                  <ArrowDownToLine size={28} />
                  <span>
                    Drop to {audio.buffer ? 'replace audio' : 'import WAV'}
                  </span>
                </div>
              )}
              {busy === 'Loading WAV' && (
                <output className="loading-overlay">
                  <LoaderCircle size={24} className="spin" />
                  Loading your waveform…
                </output>
              )}
            </div>
            <div className="timeline-bottom">
              <span>{formatTime(position)}</span>
              <span id="playback-position-label" className="sr-only">
                Playback position
              </span>
              <Slider
                aria-labelledby="playback-position-label"
                value={[position]}
                min={0}
                max={duration || 1}
                step={0.01}
                disabled={!audio.buffer || !!busy}
                onValueChange={(value) =>
                  engine.seek(Array.isArray(value) ? value[0] : value)
                }
              />
              <span>{formatTime(duration)}</span>
            </div>
          </div>
          <div className="file-strip">
            <div className="file-detail-icon">
              <FileAudio2 size={19} />
            </div>
            <div className="file-detail">
              <strong>{audio.fileName || 'No audio loaded'}</strong>
              <span>
                {audio.wav
                  ? `${(audio.fileSize / 1048576).toFixed(2)} MB · ${(audio.wav.sampleRate / 1000).toLocaleString()} kHz source · ${formatTime(duration, true)}`
                  : 'Your imported file will appear here'}
              </span>
            </div>
            {audio.buffer && (
              <IconButton
                label="Replace WAV file"
                disabled={!!busy}
                onClick={() => fileInput.current?.click()}
              >
                <ArrowDownToLine size={17} />
              </IconButton>
            )}
            <span className="local-label">
              <ShieldCheck size={14} />
              Stays on your device
            </span>
          </div>
          <div className="editor-footnote">
            <span>
              <kbd>space</kbd> play / pause{' '}
              <span className="shortcut-divider" />
              <kbd>esc</kbd> stop
            </span>
            <span>Make room for sound.</span>
          </div>
        </section>

        <aside
          className="inspector"
          aria-label="Audio settings and master output"
        >
          <section className="master-panel">
            <div className="section-heading">
              <h2>
                <Volume2 size={17} />
                Master output
              </h2>
              <span className="small-badge">STEREO</span>
            </div>
            <Meter
              levels={levels}
              clipped={clipped}
              onReset={() => setClipped(false)}
            />
            <div className="volume-heading">
              <span>Volume</span>
              <button
                className="volume-value"
                title="Reset master volume to 0 dB"
                onClick={() => engine.setVolume(0)}
              >
                {audio.volume > 0 ? '+' : ''}
                {audio.volume.toFixed(1)} <span>dB</span>
              </button>
            </div>
            <div className="volume-control">
              <IconButton
                label={audio.muted ? 'Unmute master' : 'Mute master'}
                aria-pressed={audio.muted}
                className={audio.muted ? 'muted' : ''}
                onClick={() => engine.setMuted(!audio.muted)}
              >
                {audio.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </IconButton>
              <span id="master-volume-label" className="sr-only">
                Master volume in decibels
              </span>
              <Slider
                aria-labelledby="master-volume-label"
                value={[audio.volume]}
                min={-60}
                max={6}
                step={0.1}
                onValueChange={(value) =>
                  engine.setVolume(Array.isArray(value) ? value[0] : value)
                }
              />
            </div>
            <div className="volume-scale">
              <span>−60 dB</span>
              <span>+6 dB</span>
            </div>
            <div className="output-route">
              <Headphones size={16} />
              <span title={outputName}>{outputName}</span>
              <span className="route-dot" />
            </div>
          </section>

          <section className="settings-panel">
            <div className="section-heading">
              <h2>
                <Settings2 size={17} />
                Audio settings
              </h2>
            </div>
            <div className="device-label-row">
              <span>Output device</span>
              <button
                className="text-button"
                disabled={!deviceSupported || !!busy}
                onClick={connectDevices}
              >
                {busy === 'Connecting devices' ? (
                  <LoaderCircle size={12} className="spin" />
                ) : (
                  <Plus size={12} />
                )}
                Connect
              </button>
            </div>
            <Choice
              id="output-device"
              label="Output device"
              value={audio.deviceId}
              options={[
                { value: '', label: 'System default' },
                ...devices.map((device, index) => ({
                  value: device.deviceId,
                  label: device.label || `Output ${index + 1}`,
                })),
              ]}
              onChange={(value) =>
                void run('Switching output', () => engine.setDevice(value))
              }
              disabled={!deviceSupported || !!busy}
            />
            <p className="field-note">
              {deviceSupported
                ? 'Connect to reveal devices. Your browser may request microphone access; no audio is recorded.'
                : 'This browser uses your system output. Change devices in your system sound settings.'}
            </p>
            <div className="settings-divider" />
            <Choice
              id="sample-rate"
              label="Sample rate"
              value={String(draft.sampleRate)}
              options={[
                { value: '0', label: 'Device default' },
                { value: '44100', label: '44.1 kHz' },
                { value: '48000', label: '48 kHz' },
                { value: '88200', label: '88.2 kHz' },
                { value: '96000', label: '96 kHz' },
              ]}
              onChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  sampleRate: Number(value),
                }))
              }
              disabled={!!busy}
            />
            <Choice
              id="buffer-size"
              label="Buffer size · requested"
              value={String(draft.bufferSize)}
              options={[128, 256, 512, 1024, 2048].map((value) => ({
                value: String(value),
                label: `${value} samples`,
              }))}
              onChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  bufferSize: Number(value),
                }))
              }
              disabled={!!busy}
            />
            <div className="latency-row">
              <span>Target latency</span>
              <span>
                {(
                  (draft.bufferSize /
                    (draft.sampleRate || audio.actualSampleRate || 48000)) *
                  1000
                ).toFixed(1)}{' '}
                ms
              </span>
            </div>
            <p className="field-note">
              Buffer size is a latency request. Your browser controls the actual
              audio buffer.
            </p>
            <button
              className={`button apply-button ${dirty ? 'has-changes' : ''}`}
              disabled={!!busy || !dirty}
              onClick={() =>
                void run('Applying settings', async () => {
                  await engine.configure(draft);
                  setNotice('Audio settings applied.');
                })
              }
            >
              {busy === 'Applying settings' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              {dirty ? 'Apply settings' : 'Settings up to date'}
            </button>
            <div className="engine-readout">
              <div>
                <span>Engine rate</span>
                <span>
                  {audio.actualSampleRate
                    ? `${audio.actualSampleRate / 1000} kHz`
                    : '—'}
                </span>
              </div>
              <div>
                <span>Processing latency</span>
                <span>
                  {audio.baseLatency !== null
                    ? `${(audio.baseLatency * 1000).toFixed(1)} ms`
                    : '—'}
                </span>
              </div>
              <div>
                <span>Output latency</span>
                <span>
                  {audio.outputLatency !== null
                    ? `${(audio.outputLatency * 1000).toFixed(1)} ms`
                    : '—'}
                </span>
              </div>
            </div>
          </section>
        </aside>
      </main>
      <footer className="statusbar">
        <span>
          <span className={`engine-dot ${playing ? 'active' : ''}`} />
          {playing
            ? 'Audio engine running'
            : audio.contextState === 'idle'
              ? 'Audio engine on standby'
              : audio.contextState === 'suspended'
                ? 'Audio engine suspended'
                : 'Audio engine ready'}
        </span>
        <span className="signal-path">
          <AudioLines size={13} />
          WAV
          <ChevronRight size={12} />
          Master
          <ChevronRight size={12} />
          <Headphones size={13} />
          Output
        </span>
        <span>
          MNT <span className="footer-version">/ CORE 01</span>
        </span>
      </footer>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="help-dialog">
          <DialogHeader>
            <DialogTitle>Small workspace. Full attention.</DialogTitle>
            <DialogDescription>
              Everything you need to listen closely.
            </DialogDescription>
          </DialogHeader>
          <div className="help-content">
            <p>
              <ArrowDownToLine size={18} />
              <span>
                Import one WAV, then click the waveform or drag the timeline to
                seek. Importing another file replaces it.
              </span>
            </p>
            <p>
              <Play size={18} />
              <span>
                Space plays or pauses. Esc stops and returns to the beginning.
                Audio starts only when you press play.
              </span>
            </p>
            <p>
              <Headphones size={18} />
              <span>
                Connect reveals available outputs in supported browsers over
                HTTPS or localhost. Other browsers use your system output.
              </span>
            </p>
            <p>
              <Activity size={18} />
              <span>
                Sample rate applies to the audio engine. Buffer size requests a
                latency target; reported latency depends on your browser and
                device.
              </span>
            </p>
            <p>
              <ShieldCheck size={18} />
              <span>
                Your file is processed locally and is not uploaded. Reloading
                clears this session.
              </span>
            </p>
          </div>
          <button
            className="button primary-button"
            onClick={() => setHelp(false)}
          >
            Back to the workspace
            <ArrowRight size={16} />
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
