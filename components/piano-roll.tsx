import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Circle, KeyboardMusic, Piano, Plus, Square, X } from 'lucide-react';
import { Choice, IconButton, NumberField } from './daw-controls';
import { EditMenu } from './edit-menu';
import { noteName, type MidiNote } from '@/lib/midi';
import type { Clip, Track } from '@/lib/project';
import type { ProjectSession } from '@/lib/project-session';

const LOW = 0, HIGH = 127, ROW = 16, PX = 64;
const computerKeys = ['a','w','s','e','d','f','t','g','y','h','u','j','k','o','l','p',';'];
export function PianoRoll({ clip, track, session, close, report, disabled }: { clip: Clip; track: Track; session: ProjectSession; close: () => void; report: (text: string) => void; disabled: boolean }) {
  const [selected, setSelected] = useState('');
  const [grid, setStep] = useState(.25);
  const step = Math.min(grid,clip.lengthBeats ?? 4);
  const [velocity, setVelocity] = useState(100);
  const [keyboard, setKeyboard] = useState(false);
  const [capture, setCapture] = useState(false);
  const [inputs, setInputs] = useState<MIDIInput[]>([]);
  const [inputId, setInputId] = useState('');
  const [access, setAccess] = useState<MIDIAccess | null>(null);
  const [octave, setOctave] = useState(4);
  const [cursor, setCursor] = useState(0);
  const [preview, setPreview] = useState<MidiNote | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const clipboard = useRef<MidiNote | null>(null);
  const noteDrag = useRef<{ note: MidiNote; x: number; y: number; resize: boolean } | null>(null);
  const previewRef = useRef<MidiNote | null>(null);
  const held = useRef(new Map<string, { release?: () => void; started: number; beat: number; pitch: number; velocity: number }>());
  const notes = clip.notes ?? [];
  const length = clip.lengthBeats ?? 4;
  const note = notes.find(note => note.id === selected);
  const commit = useCallback((change: (notes: MidiNote[]) => MidiNote[]) => {
    if (disabled) return;
    session.edit(project => ({ ...project, tracks: project.tracks.map(t => t.id === track.id ? { ...t, clips: t.clips.map(c => c.id === clip.id ? { ...c, notes: change(c.notes ?? []).slice(0,8192) } : c) } : t) }));
  }, [session, track.id, clip.id, disabled]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = (HIGH - 72) * ROW; }, [clip.id]);
  const panic = useCallback(() => { held.current.forEach(note => note.release?.()); held.current.clear(); session.engine.panic(); }, [session]);
  const press = useCallback((id: string, pitch: number, vel: number) => {
    if (disabled || held.current.has(id)) return;
    const project = session.getSnapshot().project;
    const at = session.engine.getSnapshot().status === 'playing' ? session.engine.position * project.tempo / 60 - clip.startBeat : cursor;
    const pending = { started: performance.now(), beat: Math.max(0,Math.min(length - step,Math.round(at / step) * step)), pitch, velocity: vel };
    held.current.set(id,pending);
    void session.preview(track.id,pitch,vel).then(release => { const current = held.current.get(id); if (current === pending) current.release = release; else release(); }).catch(error => report(error instanceof Error ? error.message : 'Instrument preview failed.'));
  }, [session, track.id, clip.startBeat, cursor, length, step, disabled, report]);
  const release = useCallback((id: string) => {
    const heldNote = held.current.get(id); if (!heldNote) return;
    heldNote.release?.(); held.current.delete(id);
    if (capture && !disabled && !id.startsWith('preview:')) {
      const tempo = session.getSnapshot().project.tempo;
      const duration = Math.max(step,Math.round((performance.now() - heldNote.started) / 1000 * tempo / 60 / step) * step);
      const note: MidiNote = { id: crypto.randomUUID(), pitch: heldNote.pitch, velocity: heldNote.velocity, start: heldNote.beat, length: Math.min(duration,length - heldNote.beat) };
      commit(notes => notes.length >= 8192 ? notes : [...notes,note]); setSelected(note.id); setCursor(Math.min(length - step,note.start + note.length));
    }
  }, [session, capture, disabled, step, length, commit]);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!keyboard || event.repeat || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest('input, textarea, [role="combobox"], [role="dialog"]')) return;
      const index = computerKeys.indexOf(event.key.toLowerCase()); if (index >= 0) { event.preventDefault(); press(`key:${event.code}`,Math.min(127,(octave + 1) * 12 + index),velocity); }
    };
    const up = (event: KeyboardEvent) => release(`key:${event.code}`);
    window.addEventListener('keydown',down); window.addEventListener('keyup',up); window.addEventListener('blur',panic);
    const hidden = () => { if (document.hidden) panic(); }; document.addEventListener('visibilitychange',hidden);
    return () => { window.removeEventListener('keydown',down); window.removeEventListener('keyup',up); window.removeEventListener('blur',panic); document.removeEventListener('visibilitychange',hidden); panic(); };
  }, [keyboard, octave, velocity, press, release, panic]);
  useEffect(() => {
    if (!access) return;
    const update = () => { setInputs([...access.inputs.values()]); panic(); };
    access.addEventListener('statechange',update);
    return () => access.removeEventListener('statechange',update);
  }, [access, panic]);
  useEffect(() => {
    const input = inputs.find(input => input.id === inputId);
    if (!input) return;
    const receive = (event: MIDIMessageEvent) => {
      const bytes = event.data; if (!bytes || bytes.length < 3) return;
      const command = bytes[0] & 0xf0, channel = bytes[0] & 15;
      const id = `midi:${input.id}:${channel}:${bytes[1]}`;
      if (command === 0x90 && bytes[2] > 0) press(id,bytes[1],bytes[2]);
      else if (command === 0x80 || command === 0x90) release(id);
      else if (command === 0xb0 && [120,123].includes(bytes[1])) panic();
    };
    input.addEventListener('midimessage',receive); return () => { input.removeEventListener('midimessage',receive); panic(); };
  }, [inputs, inputId, press, release, panic]);
  const connect = async () => {
    try {
      if (!navigator.requestMIDIAccess) throw new Error('Web MIDI is unavailable. Use the computer keyboard, or a browser with Web MIDI support over HTTPS.');
      const result = await navigator.requestMIDIAccess({ sysex: false }); setAccess(result); setInputs([...result.inputs.values()]); setInputId([...result.inputs.keys()][0] ?? '');
    } catch (error) { report(error instanceof Error ? error.message : 'MIDI permission was denied.'); }
  };
  const add = (start: number, pitch: number) => {
    if (disabled || notes.length >= 8192) return;
    const next: MidiNote = { id: crypto.randomUUID(), pitch, start: Math.max(0,Math.min(length - step,Math.floor(start / step) * step)), length: step, velocity };
    commit(notes => [...notes,next]); setSelected(next.id); setCursor(next.start); press(`preview:${next.id}`,pitch,velocity); setTimeout(() => release(`preview:${next.id}`),150);
  };
  const remove = (id: string) => commit(notes => notes.filter(note => note.id !== id));
  const copy = (note: MidiNote, cut = false) => { clipboard.current = { ...note }; if (cut) remove(note.id); };
  const paste = () => { if (!clipboard.current || notes.length >= 8192 || disabled) return; const n = { ...clipboard.current, id: crypto.randomUUID(), start: Math.min(cursor,length - clipboard.current.length) }; commit(notes => [...notes,n]); setSelected(n.id); };
  const updateNote = (patch: Partial<MidiNote>) => { if (note) commit(notes => notes.map(n => n.id === note.id ? { ...n,...patch } : n)); };
  const dragMove = (event: ReactPointerEvent) => {
    const drag = noteDrag.current; if (!drag) return;
    const dx = (event.clientX - drag.x) / PX;
    const next = drag.resize ? { ...drag.note, length: Math.min(length - drag.note.start,Math.max(step,Math.round((drag.note.length + dx) / step) * step)) } : { ...drag.note, start: Math.max(0,Math.min(length - drag.note.length,Math.round((drag.note.start + dx) / step) * step)), pitch: Math.max(0,Math.min(127,drag.note.pitch - Math.round((event.clientY - drag.y) / ROW))) };
    previewRef.current = next; setPreview(next);
  };
  const endDrag = () => { if (previewRef.current) { const changed = previewRef.current; commit(notes => notes.map(n => n.id === changed.id ? changed : n)); } noteDrag.current = null; previewRef.current = null; setPreview(null); };
  // Keyboard shortcuts are delegated from the focusable notes and controls inside this editor.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
  return <section className="piano-roll" data-piano-roll="true" aria-label="MIDI piano roll" onKeyDown={event => {
    const target = event.target as HTMLElement; if (target.closest('input, [role="combobox"]')) return;
    const command = event.ctrlKey || event.metaKey;
    if (['Delete','Backspace'].includes(event.key) && note) { event.preventDefault(); event.stopPropagation(); remove(note.id); }
    if (command && ['c','x','v','d'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); if (event.key.toLowerCase() === 'v') paste(); else if (note) { if (event.key.toLowerCase() === 'd') { const duplicate = { ...note,id:crypto.randomUUID(),start:Math.min(length - note.length,note.start + note.length) }; commit(notes => [...notes,duplicate]); } else copy(note,event.key.toLowerCase() === 'x'); } }
  }}><div className="piano-toolbar"><Piano size={15} /><strong>{clip.name}</strong><span>{notes.length} notes</span><button className={keyboard ? 'active' : ''} onClick={() => { panic(); setKeyboard(!keyboard); }} title="Play A W S E D F T G Y H U J K on your computer keyboard"><KeyboardMusic size={14} />Keys</button><button className={capture ? 'capture-active' : ''} onClick={() => { panic(); setCapture(!capture); }} title="Capture incoming keys into this MIDI clip"><Circle size={12} fill={capture ? 'currentColor' : 'none'} />Capture</button><button onClick={() => void connect()}>MIDI input</button><IconButton label="All notes off" onClick={panic}><Square size={12} /></IconButton><IconButton label="Close piano roll" onClick={() => { panic(); close(); }}><X size={14} /></IconButton></div><div className="note-properties"><Choice id="note-grid" label="Grid" value={String(step)} options={[.0625,.125,.25,.5,1].map(value => ({ value:String(value),label:`1/${4 / value}` }))} onChange={v => setStep(Number(v))} /><NumberField label="Velocity" value={note?.velocity ?? velocity} min={1} max={127} onChange={value => { setVelocity(value); updateNote({ velocity:value }); }} /><NumberField label="Pitch" value={note?.pitch ?? 60} min={0} max={127} disabled={!note} onChange={pitch => updateNote({ pitch:Math.round(pitch) })} /><NumberField label="Start" value={note?.start ?? cursor} min={0} max={length - (note?.length ?? step)} step={step} onChange={start => { setCursor(start); updateNote({ start }); }} /><NumberField label="Length" value={note?.length ?? step} min={step} max={length - (note?.start ?? cursor)} step={step} disabled={!note} onChange={length => updateNote({ length })} /><NumberField label="Octave" value={octave} min={0} max={8} onChange={setOctave} />{inputs.length > 0 && <Choice id="midi-input" label="MIDI device" value={inputId} options={[{ value:'',label:'None' },...inputs.map(input => ({ value:input.id,label:input.name ?? 'MIDI input' }))]} onChange={id => { panic(); setInputId(id); }} />}</div><div className="piano-scroll" ref={scroll}><div className="piano-surface" style={{ width:55 + length * PX, height:(HIGH - LOW + 1) * ROW }}><div className="piano-keys">{Array.from({ length:HIGH - LOW + 1 },(_,i) => { const pitch = HIGH - i; return <button key={pitch} className={[1,3,6,8,10].includes(pitch % 12) ? 'black-key' : 'white-key'} style={{ top:i * ROW,height:ROW }} aria-label={`Play ${noteName(pitch)}`} onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); press(`piano:${pitch}`,pitch,velocity); }} onPointerUp={() => release(`piano:${pitch}`)} onPointerCancel={() => release(`piano:${pitch}`)}>{noteName(pitch)}</button>; })}</div><EditMenu actions={[{ label:'Paste note',action:paste },{ label:'Add C4 at cursor',action:() => add(cursor,60) }]}><div className="note-grid" style={{ left:55,width:length * PX,height:'100%', '--note-step':`${step * PX}px` } as React.CSSProperties} onPointerDown={event => { if (event.button !== 0 || event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); add((event.clientX - rect.left) / PX,HIGH - Math.floor((event.clientY - rect.top) / ROW)); }}>{notes.map(original => { const n = preview?.id === original.id ? preview : original; return <EditMenu key={n.id} actions={[{ label:'Cut note',action:() => copy(n,true) },{ label:'Copy note',action:() => copy(n) },{ label:'Paste note',action:paste },{ label:'Duplicate note',action:() => commit(notes => [...notes,{ ...n,id:crypto.randomUUID(),start:Math.min(length - n.length,n.start + n.length) }]) },{ label:'Delete note',action:() => remove(n.id),destructive:true }]}><button className={`midi-note ${selected === n.id ? 'selected-note' : ''}`} style={{ left:n.start * PX,top:(HIGH - n.pitch) * ROW,width:Math.max(5,n.length * PX),height:ROW - 1,opacity:.4 + n.velocity / 127 * .6 }} title={`${noteName(n.pitch)} · velocity ${n.velocity}`} aria-label={`${noteName(n.pitch)}, velocity ${n.velocity}, length ${n.length} beats`} onPointerDown={event => { if (disabled || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setSelected(n.id); setCursor(n.start); noteDrag.current = { note:original,x:event.clientX,y:event.clientY,resize:(event.target as HTMLElement).classList.contains('note-tail') }; }} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={() => { noteDrag.current = null; previewRef.current = null; setPreview(null); }} onKeyDown={event => { if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); commit(notes => notes.map(note => note.id !== n.id ? note : { ...note,pitch:Math.max(0,Math.min(127,note.pitch + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0))),start:Math.max(0,Math.min(length - note.length,note.start + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))) })); }}><span>{noteName(n.pitch)}</span><i className="note-tail" /></button></EditMenu>; })}</div></EditMenu></div></div><div className="piano-footer"><button onClick={() => add(cursor,60)} disabled={disabled}><Plus size={12} />Add note</button><span>Click to draw · Drag to move · Drag right edge for length · Right-click to edit</span><b>{capture ? 'CAPTURE ARMED' : 'MIDI EDITOR'}</b></div></section>;
}
