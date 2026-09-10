import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Circle,
  KeyboardMusic,
  Piano,
  Plus,
  Minus,
  Square,
  X,
} from 'lucide-react';
import { Choice, IconButton, NumberField } from './daw-controls';
import { EditMenu } from './edit-menu';
import { moveNotes, resizeNotes, pasteNotes, notesInBox } from '@/lib/editing';
import { noteName, type MidiNote } from '@/lib/midi';
import type { Clip, Track } from '@/lib/project';
import type { ProjectSession } from '@/lib/project-session';

const LOW = 0,
  HIGH = 127,
  ROW = 16;
const computerKeys = [
  'a',
  'w',
  's',
  'e',
  'd',
  'f',
  't',
  'g',
  'y',
  'h',
  'u',
  'j',
  'k',
  'o',
  'l',
  'p',
  ';',
];
export function PianoRoll({
  clip,
  track,
  session,
  close,
  report,
  disabled,
}: {
  clip: Clip;
  track: Track;
  session: ProjectSession;
  close: () => void;
  report: (text: string) => void;
  disabled: boolean;
}) {
  const [selection, setSelection] = useState<string[]>([]);
  const setSelected = useCallback(
    (id: string) => setSelection(id ? [id] : []),
    [],
  );
  const selected = selection.at(-1) ?? '';
  const [zoom, setZoom] = useState(64);
  const PX = zoom;
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const boxDrag = useRef<{
    x: number;
    y: number;
    base: string[];
    moved: boolean;
    additive: boolean;
  } | null>(null);
  const [grid, setStep] = useState(0.25);
  const step = Math.min(grid, clip.lengthBeats ?? 4);
  const [velocity, setVelocity] = useState(100);
  const [keyboard, setKeyboard] = useState(false);
  const [capture, setCapture] = useState(false);
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [inputId, setInputId] = useState('');
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [octave, setOctave] = useState(4);
  const [cursor, setCursor] = useState(0);
  const [preview, setPreview] = useState<MidiNote[] | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const noteDrag = useRef<{
    note: MidiNote;
    notes: MidiNote[];
    x: number;
    y: number;
    resize: boolean;
  } | null>(null);
  const previewRef = useRef<MidiNote[] | null>(null);
  const held = useRef(
    new Map<
      string,
      {
        release?: () => void;
        started: number;
        beat: number;
        pitch: number;
        velocity: number;
        captureEligible: boolean;
      }
    >(),
  );
  const notes = clip.notes ?? [];
  const length = clip.lengthBeats ?? 4;
  useEffect(() => {
    if (disabled) {
      held.current.forEach((n) => n.release?.());
      held.current.clear();
      session.engine.panic();
    }
  }, [disabled, session]);
  const note = notes.find((note) => note.id === selected);
  const selectedNotes = notes.filter((n) => selection.includes(n.id));
  const commit = useCallback(
    (change: (notes: MidiNote[]) => MidiNote[]) => {
      if (disabled) return;
      session.edit((project) => ({
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === track.id
            ? {
                ...t,
                clips: t.clips.map((c) =>
                  c.id === clip.id
                    ? { ...c, notes: change(c.notes ?? []).slice(0, 8192) }
                    : c,
                ),
              }
            : t,
        ),
      }));
    },
    [session, track.id, clip.id, disabled],
  );
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = (HIGH - 72) * ROW;
  }, [clip.id]);
  const panic = useCallback(() => {
    held.current.forEach((note) => note.release?.());
    held.current.clear();
    session.engine.panic();
  }, [session]);
  const press = useCallback(
    (id: string, pitch: number, vel: number) => {
      if (disabled || held.current.has(id)) return;
      const project = session.getSnapshot().project;
      const at =
        session.engine.getSnapshot().status === 'playing'
          ? (session.engine.position * project.tempo) / 60 - clip.startBeat
          : cursor;
      const pending = {
        started: performance.now(),
        captureEligible: at >= 0 && at < length,
        beat: Math.max(
          0,
          Math.min(length - step, Math.round(at / step) * step),
        ),
        pitch,
        velocity: vel,
      };
      held.current.set(id, pending);
      void session
        .preview(track.id, pitch, vel)
        .then((release) => {
          const current = held.current.get(id);
          if (current === pending) current.release = release;
          else release();
        })
        .catch((error) =>
          report(
            error instanceof Error
              ? error.message
              : 'Instrument preview failed.',
          ),
        );
    },
    [session, track.id, clip.startBeat, cursor, length, step, disabled, report],
  );
  const release = useCallback(
    (id: string) => {
      const heldNote = held.current.get(id);
      if (!heldNote) return;
      heldNote.release?.();
      held.current.delete(id);
      if (
        capture &&
        !disabled &&
        heldNote.captureEligible &&
        !id.startsWith('preview:')
      ) {
        const tempo = session.getSnapshot().project.tempo;
        const duration = Math.max(
          step,
          Math.round(
            (((performance.now() - heldNote.started) / 1000) * tempo) /
              60 /
              step,
          ) * step,
        );
        const note: MidiNote = {
          id: crypto.randomUUID(),
          pitch: heldNote.pitch,
          velocity: heldNote.velocity,
          start: heldNote.beat,
          length: Math.min(duration, length - heldNote.beat),
        };
        commit((notes) => (notes.length >= 8192 ? notes : [...notes, note]));
        setSelected(note.id);
        setCursor(Math.min(length - step, note.start + note.length));
      }
    },
    [session, capture, disabled, step, length, commit, setSelected],
  );
  const inputHandlers = useRef({ press, release });
  useEffect(() => {
    inputHandlers.current = { press, release };
  }, [press, release]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        !keyboard ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target as HTMLElement).closest(
          'input, textarea, [role="combobox"], [role="dialog"]',
        )
      )
        return;
      const index = computerKeys.indexOf(event.key.toLowerCase());
      if (index >= 0) {
        event.preventDefault();
        inputHandlers.current.press(
          `key:${event.code}`,
          Math.min(127, (octave + 1) * 12 + index),
          velocity,
        );
      }
    };
    const up = (event: KeyboardEvent) =>
      inputHandlers.current.release(`key:${event.code}`);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', panic);
    const hidden = () => {
      if (document.hidden) panic();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', panic);
      document.removeEventListener('visibilitychange', hidden);
      panic();
    };
  }, [keyboard, octave, velocity, panic]);
  useEffect(() => {
    if (!access) return;
    const update = () => {
      setInputs([...access.inputs.values()]);
      panic();
    };
    access.addEventListener('statechange', update);
    return () => access.removeEventListener('statechange', update);
  }, [access, panic]);
  useEffect(() => {
    const input = inputs.find((input) => input.id === inputId);
    if (!input) return;
    const receive = (event: MIDIMessageEvent) => {
      const bytes = event.data;
      if (!bytes || bytes.length < 3) return;
      const command = bytes[0] & 0xf0,
        channel = bytes[0] & 15;
      const id = `midi:${input.id}:${channel}:${bytes[1]}`;
      if (command === 0x90 && bytes[2] > 0)
        inputHandlers.current.press(id, bytes[1], bytes[2]);
      else if (command === 0x80 || command === 0x90)
        inputHandlers.current.release(id);
      else if (command === 0xb0 && [120, 123].includes(bytes[1])) panic();
    };
    input.addEventListener('midimessage', receive);
    return () => {
      input.removeEventListener('midimessage', receive);
      panic();
    };
  }, [inputs, inputId, panic]);
  const connect = async () => {
    try {
      if (!navigator.requestMIDIAccess)
        throw new Error(
          'Web MIDI is unavailable. Use the computer keyboard, or a browser with Web MIDI support over HTTPS.',
        );
      const result = await navigator.requestMIDIAccess({ sysex: false });
      setAccess(result);
      setInputs([...result.inputs.values()]);
      setInputId([...result.inputs.keys()][0] ?? '');
    } catch (error) {
      report(
        error instanceof Error ? error.message : 'MIDI permission was denied.',
      );
    }
  };
  const add = (start: number, pitch: number) => {
    if (disabled || notes.length >= 8192) return;
    const next: MidiNote = {
      id: crypto.randomUUID(),
      pitch: Math.max(0, Math.min(127, pitch)),
      start: Math.max(
        0,
        Math.min(length - step, Math.floor(start / step) * step),
      ),
      length: step,
      velocity,
    };
    commit((notes) => [...notes, next]);
    setSelected(next.id);
    setCursor(next.start);
    press(`preview:${next.id}`, pitch, velocity);
    setTimeout(() => release(`preview:${next.id}`), 150);
  };
  const replaceNotes = (changed: MidiNote[]) => {
    const updates = new Map(changed.map((n) => [n.id, n]));
    commit((notes) => notes.map((n) => updates.get(n.id) ?? n));
  };
  const groupFor = (target?: MidiNote) =>
    target && !selection.includes(target.id) ? [target] : selectedNotes;
  const remove = (group = selectedNotes) => {
    const ids = new Set(group.map((n) => n.id));
    commit((notes) => notes.filter((n) => !ids.has(n.id)));
    setSelection((idsInSelection) =>
      idsInSelection.filter((id) => !ids.has(id)),
    );
  };
  const copy = (group = selectedNotes, cut = false) => {
    if (!group.length || disabled) return;
    session.copyNotes(group);
    if (cut) remove(group);
  };
  const insert = (copied: MidiNote[], at: number) => {
    if (disabled || !copied.length) return;
    try {
      if (notes.length + copied.length > 8192)
        throw new Error('Maximum 8192 notes per clip.');
      const created = pasteNotes(copied, at, length);
      commit((notes) => [...notes, ...created]);
      setSelection(created.map((n) => n.id));
    } catch (error) {
      report(error instanceof Error ? error.message : 'Could not paste notes.');
    }
  };
  const paste = () => insert(session.copiedNotes(), cursor);
  const duplicate = (group = selectedNotes) => {
    if (group.length)
      insert(group, Math.max(...group.map((n) => n.start + n.length)));
  };
  const updateNote = (patch: Partial<MidiNote>) => {
    if (!note) return;
    if (patch.start !== undefined)
      replaceNotes(
        moveNotes(selectedNotes, patch.start - note.start, 0, length),
      );
    else if (patch.pitch !== undefined)
      replaceNotes(
        moveNotes(selectedNotes, 0, patch.pitch - note.pitch, length),
      );
    else if (patch.length !== undefined)
      replaceNotes(
        resizeNotes(selectedNotes, patch.length - note.length, length, 0.001),
      );
    else replaceNotes(selectedNotes.map((n) => ({ ...n, ...patch })));
  };
  const dragMove = (event: ReactPointerEvent) => {
    const drag = noteDrag.current;
    if (
      !drag ||
      Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 3
    )
      return;
    const dx = (event.clientX - drag.x) / PX;
    const delta =
      Math.round(
        ((drag.resize ? drag.note.length : drag.note.start) + dx) / step,
      ) *
        step -
      (drag.resize ? drag.note.length : drag.note.start);
    const next = drag.resize
      ? resizeNotes(drag.notes, delta, length, step)
      : moveNotes(
          drag.notes,
          delta,
          -Math.round((event.clientY - drag.y) / ROW),
          length,
        );
    previewRef.current = next;
    setPreview(next);
  };
  const endDrag = () => {
    if (previewRef.current) replaceNotes(previewRef.current);
    noteDrag.current = null;
    previewRef.current = null;
    setPreview(null);
  };
  const zoomTo = useCallback(
    (value: number) => {
      const next = Math.max(16, Math.min(256, value));
      const viewport = scroll.current;
      const anchor = viewport
        ? (viewport.scrollLeft + Math.max(0, viewport.clientWidth - 55) / 2) /
          PX
        : cursor;
      setZoom(next);
      if (viewport)
        requestAnimationFrame(() => {
          viewport.scrollLeft = Math.max(
            0,
            anchor * next - Math.max(0, viewport.clientWidth - 55) / 2,
          );
        });
    },
    [PX, cursor],
  );
  useEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomTo(PX * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [PX, zoomTo]);
  const boxMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = boxDrag.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(length * PX, event.clientX - rect.left));
    const y = Math.max(
      0,
      Math.min((HIGH - LOW + 1) * ROW - 1, event.clientY - rect.top),
    );
    if (!drag.moved && Math.abs(x - drag.x) + Math.abs(y - drag.y) < 4) return;
    drag.moved = true;
    setBox({
      left: Math.min(x, drag.x),
      top: Math.min(y, drag.y),
      width: Math.abs(x - drag.x),
      height: Math.abs(y - drag.y),
    });
    const found = notesInBox(
      notes,
      drag.x / PX,
      x / PX,
      HIGH - Math.floor(drag.y / ROW),
      HIGH - Math.floor(y / ROW),
    );
    setSelection([...new Set([...drag.base, ...found])]);
  };
  const boxEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = boxDrag.current;
    if (!drag) return;
    boxDrag.current = null;
    setBox(null);
    if (!drag.moved && !drag.additive)
      add(drag.x / PX, HIGH - Math.floor(drag.y / ROW));
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  // Keyboard shortcuts are delegated from the focusable notes and controls inside this editor.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className="piano-roll"
      data-piano-roll="true"
      aria-label="MIDI piano roll"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('input, [role="combobox"], [role="menu"]')) return;
        const command = event.ctrlKey || event.metaKey;
        if (['Delete', 'Backspace'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          remove();
        }
        if (
          command &&
          ['a', 'c', 'x', 'v', 'd', '+', '=', '-', '0'].includes(
            event.key.toLowerCase(),
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          const key = event.key.toLowerCase();
          if (key === 'a') setSelection(notes.map((n) => n.id));
          else if (key === 'v') paste();
          else if (key === 'd') duplicate();
          else if (key === 'c' || key === 'x') copy(selectedNotes, key === 'x');
          else zoomTo(key === '0' ? 64 : PX * (key === '-' ? 1 / 1.25 : 1.25));
        }
        if (
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
            event.key,
          ) &&
          selectedNotes.length
        ) {
          event.preventDefault();
          event.stopPropagation();
          replaceNotes(
            moveNotes(
              selectedNotes,
              event.key === 'ArrowRight'
                ? step
                : event.key === 'ArrowLeft'
                  ? -step
                  : 0,
              event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0,
              length,
            ),
          );
        }
      }}
    >
      <div className="piano-toolbar">
        <Piano size={15} />
        <strong>{clip.name}</strong>
        <span>
          {selectedNotes.length
            ? `${selectedNotes.length} selected`
            : `${notes.length} notes`}
        </span>
        <button
          className={keyboard ? 'active' : ''}
          onClick={() => {
            panic();
            setKeyboard(!keyboard);
          }}
          title="Play A W S E D F T G Y H U J K on your computer keyboard"
        >
          <KeyboardMusic size={14} />
          Keys
        </button>
        <button
          className={capture ? 'capture-active' : ''}
          onClick={() => {
            panic();
            setCapture(!capture);
          }}
          title="Capture incoming keys into this MIDI clip"
        >
          <Circle size={12} fill={capture ? 'currentColor' : 'none'} />
          Capture
        </button>
        <button onClick={() => void connect()}>MIDI input</button>
        <IconButton label="All notes off" onClick={panic}>
          <Square size={12} />
        </IconButton>
        <IconButton
          label="Close piano roll"
          onClick={() => {
            panic();
            close();
          }}
        >
          <X size={14} />
        </IconButton>
      </div>
      <div className="note-properties">
        <div className="piano-zoom">
          <span>Zoom</span>
          <div>
            <IconButton
              label="Piano roll zoom out (Ctrl+-)"
              disabled={PX <= 16}
              onClick={() => zoomTo(PX / 1.25)}
            >
              <Minus size={12} />
            </IconButton>
            <button title="Reset piano roll zoom" onClick={() => zoomTo(64)}>
              {Math.round((PX / 64) * 100)}%
            </button>
            <IconButton
              label="Piano roll zoom in (Ctrl++)"
              disabled={PX >= 256}
              onClick={() => zoomTo(PX * 1.25)}
            >
              <Plus size={12} />
            </IconButton>
          </div>
        </div>
        <Choice
          id="note-grid"
          label="Grid"
          value={String(step)}
          options={[0.0625, 0.125, 0.25, 0.5, 1].map((value) => ({
            value: String(value),
            label: `1/${4 / value}`,
          }))}
          onChange={(v) => setStep(Number(v))}
        />
        <NumberField
          label="Velocity"
          value={note?.velocity ?? velocity}
          min={1}
          max={127}
          onChange={(value) => {
            setVelocity(Math.round(value));
            updateNote({ velocity: Math.round(value) });
          }}
        />
        <NumberField
          label="Pitch"
          value={note?.pitch ?? 60}
          min={0}
          max={127}
          disabled={!note}
          onChange={(pitch) => updateNote({ pitch: Math.round(pitch) })}
        />
        <NumberField
          label="Start"
          value={note?.start ?? cursor}
          min={0}
          max={length - (note?.length ?? step)}
          step={step}
          onChange={(start) => {
            setCursor(start);
            updateNote({ start });
          }}
        />
        <NumberField
          label="Length"
          value={note?.length ?? step}
          min={step}
          max={length - (note?.start ?? cursor)}
          step={step}
          disabled={!note}
          onChange={(length) => updateNote({ length })}
        />
        <NumberField
          label="Octave"
          value={octave}
          min={0}
          max={8}
          onChange={(value) => setOctave(Math.round(value))}
        />
        {inputs.length > 0 && (
          <Choice
            id="midi-input"
            label="MIDI device"
            value={inputId}
            options={[
              { value: '', label: 'None' },
              ...inputs.map((input) => ({
                value: input.id,
                label: input.name ?? 'MIDI input',
              })),
            ]}
            onChange={(id) => {
              panic();
              setInputId(id);
            }}
          />
        )}
      </div>
      <div className="piano-scroll" ref={scroll}>
        <div
          className="piano-surface"
          style={{ width: 55 + length * PX, height: (HIGH - LOW + 1) * ROW }}
        >
          <div className="piano-keys">
            {Array.from({ length: HIGH - LOW + 1 }, (_, i) => {
              const pitch = HIGH - i;
              return (
                <button
                  key={pitch}
                  className={
                    [1, 3, 6, 8, 10].includes(pitch % 12)
                      ? 'black-key'
                      : 'white-key'
                  }
                  style={{ top: i * ROW, height: ROW }}
                  aria-label={`Play ${noteName(pitch)}`}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    press(`piano:${pitch}`, pitch, velocity);
                  }}
                  onPointerUp={() => release(`piano:${pitch}`)}
                  onPointerCancel={() => release(`piano:${pitch}`)}
                >
                  {noteName(pitch)}
                </button>
              );
            })}
          </div>
          <EditMenu
            actions={[
              { label: 'Paste notes at cursor', action: paste },
              {
                label: 'Select all notes',
                action: () => setSelection(notes.map((n) => n.id)),
              },
              { label: 'Add C4 at cursor', action: () => add(cursor, 60) },
            ]}
          >
            <div
              className="note-grid"
              style={
                {
                  left: 55,
                  width: length * PX,
                  height: '100%',
                  '--note-step': `${step * PX}px`,
                  '--quarter-width': `${PX}px`,
                } as React.CSSProperties
              }
              tabIndex={-1}
              aria-label="Piano roll note grid"
              onPointerDown={(event) => {
                if (
                  disabled ||
                  event.button !== 0 ||
                  event.target !== event.currentTarget
                )
                  return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                const rect = event.currentTarget.getBoundingClientRect();
                const x = Math.max(0, event.clientX - rect.left),
                  y = Math.max(0, event.clientY - rect.top);
                const additive =
                  event.ctrlKey || event.metaKey || event.shiftKey;
                boxDrag.current = {
                  x,
                  y,
                  base: additive ? selection : [],
                  moved: false,
                  additive,
                };
                setCursor(
                  Math.max(
                    0,
                    Math.min(length - step, Math.floor(x / PX / step) * step),
                  ),
                );
                if (!additive) setSelection([]);
              }}
              onPointerMove={boxMove}
              onPointerUp={boxEnd}
              onPointerCancel={() => {
                const drag = boxDrag.current;
                if (drag) setSelection(drag.base);
                boxDrag.current = null;
                setBox(null);
              }}
            >
              {notes.map((original) => {
                const n =
                  preview?.find((n) => n.id === original.id) ?? original;
                return (
                  <EditMenu
                    key={n.id}
                    actions={[
                      {
                        label: 'Cut selected notes',
                        action: () => copy(groupFor(n), true),
                        disabled,
                      },
                      {
                        label: 'Copy selected notes',
                        action: () => copy(groupFor(n)),
                        disabled,
                      },
                      {
                        label: 'Paste notes at cursor',
                        action: paste,
                        disabled,
                      },
                      {
                        label: 'Duplicate selected notes',
                        action: () => duplicate(groupFor(n)),
                        disabled,
                      },
                      {
                        label: 'Delete selected notes',
                        action: () => remove(groupFor(n)),
                        destructive: true,
                        disabled,
                      },
                    ]}
                  >
                    <button
                      className={`midi-note ${selection.includes(n.id) ? 'selected-note' : ''}`}
                      style={{
                        left: n.start * PX,
                        top: (HIGH - n.pitch) * ROW,
                        width: Math.max(5, n.length * PX),
                        height: ROW - 1,
                        opacity: 0.4 + (n.velocity / 127) * 0.6,
                      }}
                      title={`${noteName(n.pitch)} · velocity ${n.velocity}`}
                      aria-label={`${noteName(n.pitch)}, velocity ${n.velocity}, length ${n.length} beats`}
                      aria-pressed={selection.includes(n.id)}
                      onContextMenu={() => {
                        if (!selection.includes(n.id)) setSelected(n.id);
                      }}
                      onPointerDown={(event) => {
                        if (disabled || event.button !== 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.focus();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        if (event.ctrlKey || event.metaKey) {
                          setSelection((ids) =>
                            ids.includes(n.id)
                              ? ids.filter((id) => id !== n.id)
                              : [...ids, n.id],
                          );
                          return;
                        }
                        const group = groupFor(original);
                        if (!selection.includes(n.id)) setSelected(n.id);
                        setCursor(n.start);
                        noteDrag.current = {
                          note: original,
                          notes: group,
                          x: event.clientX,
                          y: event.clientY,
                          resize: (
                            event.target as HTMLElement
                          ).classList.contains('note-tail'),
                        };
                      }}
                      onPointerMove={dragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={() => {
                        noteDrag.current = null;
                        previewRef.current = null;
                        setPreview(null);
                      }}
                    >
                      <span>{noteName(n.pitch)}</span>
                      <i className="note-tail" />
                    </button>
                  </EditMenu>
                );
              })}
              {box && (
                <div
                  className="note-selection-box"
                  style={box}
                  aria-hidden="true"
                />
              )}
              <div
                className="note-cursor"
                style={{ left: cursor * PX }}
                aria-hidden="true"
              />
            </div>
          </EditMenu>
        </div>
      </div>
      <div className="piano-footer">
        <button onClick={() => add(cursor, 60)} disabled={disabled}>
          <Plus size={12} />
          Add note
        </button>
        <span>
          Click to draw / Drag empty space to select / Ctrl-click to toggle /
          Ctrl+C, Ctrl+V
        </span>
        <b>{capture ? 'CAPTURE ARMED' : 'MIDI EDITOR'}</b>
      </div>
    </section>
  );
}
