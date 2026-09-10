import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react';
import { Check, Headphones, LoaderCircle, Plus, Settings2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { gainToDb } from '@/lib/audio-utils';
import type { AudioEngine } from '@/lib/audio-engine';

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`icon-button ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function Choice({
  label,
  id,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  id: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="setting-field">
      <label htmlFor={id} id={`${id}-label`}>
        {label}
      </label>
      <Select
        items={options}
        value={value}
        onValueChange={(value) => {
          if (value !== null) onChange(value);
        }}
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
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        key={value}
        type="number"
        aria-label={label}
        defaultValue={Number(value.toFixed(3))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onBlur={(event) => {
          // Display rounding must not change an untouched triplet position.
          if (event.target.value === event.target.defaultValue) return;
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) {
            const safe = Math.max(min, Math.min(max, next));
            if (safe !== value) onChange(safe);
            event.target.value = String(safe);
          } else event.target.value = String(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function LevelMeter({
  levels,
  clipped,
  reset,
}: {
  levels: number[];
  clipped: boolean;
  reset: () => void;
}) {
  const dbs = levels.map(gainToDb);
  const peak = Math.max(...dbs);
  return (
    <div className="master-meter">
      <div className="meter-heading">
        <span>STEREO OUTPUT</span>
        <button
          className={clipped ? 'clip-warning' : ''}
          onClick={reset}
          title="Reset clipping indicator"
        >
          {clipped ? 'CLIP' : peak > -60 ? `${peak.toFixed(1)} dB` : '−∞ dB'}
        </button>
      </div>
      {dbs.map((db, i) => (
        <div className="meter-channel" key={i}>
          <span>{i ? 'R' : 'L'}</span>
          <meter
            className="sr-only"
            min={-60}
            max={0}
            value={Math.max(-60, Math.min(0, db))}
            aria-label={`${i ? 'Right' : 'Left'} master level`}
          />
          <div className="meter-bar" aria-hidden="true">
            <div
              className="meter-cover"
              style={{
                width: `${100 - Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`,
              }}
            />
          </div>
        </div>
      ))}
      <div className="meter-ticks">
        <span>−60</span>
        <span>−36</span>
        <span>−12</span>
        <span>0 dB</span>
      </div>
    </div>
  );
}
export function AudioSettings({
  engine,
  open,
  onOpenChange,
  busy,
  run,
  report,
}: {
  engine: AudioEngine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: string;
  run: (label: string, action: () => Promise<void>) => Promise<void>;
  report: (text: string) => void;
}) {
  const audio = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [draft, setDraft] = useState(audio.settings);
  const supported = engine.canSelectDevice;
  const refresh = useCallback(async () => {
    const outputs = navigator.mediaDevices?.enumerateDevices
      ? (await navigator.mediaDevices.enumerateDevices()).filter(
          (device) =>
            device.kind === 'audiooutput' &&
            device.deviceId &&
            device.deviceId !== 'default',
        )
      : [];
    setDevices(outputs);
    return outputs;
  }, []);
  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch(() => {});
    const changed = () => {
      void refresh()
        .then(async (outputs) => {
          const id = engine.getSnapshot().deviceId;
          if (id && !outputs.some((device) => device.deviceId === id)) {
            await engine.setDevice('');
            report('Output disconnected. Using the system default.');
          }
        })
        .catch(() =>
          report(
            'Could not refresh audio devices. Reconnect in Audio settings.',
          ),
        );
    };
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    return () =>
      navigator.mediaDevices?.removeEventListener('devicechange', changed);
  }, [engine, refresh, report]);
  const connect = () =>
    void run('Connecting devices', async () => {
      const media = navigator.mediaDevices as MediaDevices & {
        selectAudioOutput?: () => Promise<MediaDeviceInfo>;
      };
      if (!media) throw new Error('Device selection needs HTTPS or localhost.');
      if (media.selectAudioOutput) {
        const device = await media.selectAudioOutput();
        await engine.setDevice(device.deviceId);
        const outputs = await refresh();
        if (!outputs.some((output) => output.deviceId === device.deviceId))
          setDevices([...outputs, device]);
      } else {
        const stream = await media.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        await refresh();
        report('Devices connected. Choose your output.');
      }
    });
  const dirty =
    draft.sampleRate !== audio.settings.sampleRate ||
    draft.bufferSize !== audio.settings.bufferSize;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog">
        <DialogTitle>
          <Settings2 size={18} />
          Audio settings
        </DialogTitle>
        <DialogDescription>
          Output and audio engine preferences for this device.
        </DialogDescription>
        <div className="settings-connect">
          <Headphones size={16} />
          <span>Audio output</span>
          <button disabled={!supported || !!busy} onClick={connect}>
            <Plus size={13} />
            Connect
          </button>
        </div>
        <Choice
          id="audio-output"
          label="Output device"
          value={audio.deviceId}
          options={[
            { value: '', label: 'System default' },
            ...devices.map((device, index) => ({
              value: device.deviceId,
              label: device.label || `Output ${index + 1}`,
            })),
          ]}
          disabled={!supported || !!busy}
          onChange={(id) =>
            void run('Switching output', () => engine.setDevice(id))
          }
        />
        <p className="field-note">
          {supported
            ? 'Connect may request microphone permission to reveal device names. No microphone audio is recorded.'
            : 'This browser uses your system output. Select devices in system sound settings.'}
        </p>
        <div className="settings-grid">
          <Choice
            id="sample-rate"
            label="Sample rate"
            value={String(draft.sampleRate)}
            options={[
              { value: '0', label: 'Device default' },
              ...[44100, 48000, 88200, 96000].map((value) => ({
                value: String(value),
                label: `${value / 1000} kHz`,
              })),
            ]}
            disabled={!!busy}
            onChange={(value) =>
              setDraft((old) => ({ ...old, sampleRate: Number(value) }))
            }
          />
          <Choice
            id="buffer-size"
            label="Buffer · requested"
            value={String(draft.bufferSize)}
            options={[128, 256, 512, 1024, 2048].map((value) => ({
              value: String(value),
              label: `${value} samples`,
            }))}
            disabled={!!busy}
            onChange={(value) =>
              setDraft((old) => ({ ...old, bufferSize: Number(value) }))
            }
          />
        </div>
        <p className="field-note">
          Buffer size requests a latency target; your browser controls the
          hardware buffer. Target:{' '}
          {(
            (draft.bufferSize /
              (draft.sampleRate || audio.actualSampleRate || 48000)) *
            1000
          ).toFixed(1)}{' '}
          ms.
        </p>
        <div className="engine-details">
          <span>
            Engine{' '}
            <b>
              {audio.actualSampleRate
                ? `${audio.actualSampleRate / 1000} kHz`
                : '—'}
            </b>
          </span>
          <span>
            Processing{' '}
            <b>
              {audio.baseLatency !== null
                ? `${(audio.baseLatency * 1000).toFixed(1)} ms`
                : '—'}
            </b>
          </span>
          <span>
            Output{' '}
            <b>
              {audio.outputLatency !== null
                ? `${(audio.outputLatency * 1000).toFixed(1)} ms`
                : '—'}
            </b>
          </span>
        </div>
        <button
          className="button primary"
          disabled={!dirty || !!busy}
          onClick={() =>
            void run('Applying settings', () => engine.configure(draft))
          }
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Check size={15} />
          )}
          {dirty ? 'Apply settings' : 'Settings up to date'}
        </button>
      </DialogContent>
    </Dialog>
  );
}
