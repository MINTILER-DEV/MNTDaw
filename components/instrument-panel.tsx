import { useRef, useState } from 'react';
import { Cable, Piano, Upload } from 'lucide-react';
import { Choice, NumberField } from './daw-controls';
import { defaultInstrument, type Instrument } from '@/lib/midi';
import { nativeHost, type NativeParameter, type NativePlugin } from '@/lib/native-host';
import type { Track } from '@/lib/project';
import type { ProjectSession } from '@/lib/project-session';

const controls = [
  ['attack','Attack · s',.001,4,.001], ['decay','Decay · s',.001,4,.01],
  ['sustain','Sustain',0,1,.01], ['release','Release · s',.005,8,.01],
  ['cutoff','Cutoff · Hz',40,18000,1], ['resonance','Resonance',.1,20,.1],
  ['detune','Detune · cents',-100,100,1],
] as const;
export function InstrumentPanel({ track, session, busy, run }: { track: Track; session: ProjectSession; busy: boolean; run: (label: string, action: () => Promise<void>) => void }) {
  const instrument = track.instrument ?? defaultInstrument();
  const sfInput = useRef<HTMLInputElement>(null);
  const [token,setToken] = useState(nativeHost.token);
  const [plugins,setPlugins] = useState<NativePlugin[]>([]);
  const [parameters,setParameters] = useState<NativeParameter[]>([]);
  const [query,setQuery] = useState('');
  const [showHost,setShowHost] = useState(false);
  const change = (next: Instrument) => { session.engine.panic(); session.edit(p => ({ ...p,tracks:p.tracks.map(t => t.id === track.id ? { ...t,instrument:next } : t) })); };
  const parameter = (id: string,value: number) => change({ ...instrument,parameters:{ ...instrument.parameters,[id]:value } });
  const project = session.getSnapshot().project;
  const banks = project.assets.filter(a => a.kind === 'soundfont');
  const chooseBank = (id: string) => { const preset = session.presets.get(id)?.[0]; if (preset) change({ type:'soundfont',soundfontId:id,program:preset.program,bank:preset.bank,parameters:{} }); };
  const presets = session.presets.get(instrument.soundfontId ?? '') ?? [];
  const choosePlugin = (id: string) => run('Reading instrument parameters', async () => {
    const values = await nativeHost.parameters(id); setParameters(values);
    change({ type:'vst3',pluginId:id,pluginName:plugins.find(p => p.id === id)?.name ?? instrument.pluginName ?? 'VST3 instrument',parameters:Object.fromEntries(values.map(p => [p.id,instrument.pluginId === id ? instrument.parameters[p.id] ?? p.value : p.value])) });
  });
  return <div className="instrument-panel"><div className="instrument-heading"><Piano size={14} /><strong>Instrument</strong><span>{instrument.type.toUpperCase()}</span></div>
    <div className="instrument-tabs"><button className={instrument.type === 'synth' ? 'active' : ''} disabled={busy} onClick={() => change(defaultInstrument())}>Synth</button><button disabled={busy} onClick={() => sfInput.current?.click()}>SoundFont</button><button className={showHost ? 'active' : ''} onClick={() => setShowHost(!showHost)}>VST3</button></div>
    {instrument.type === 'synth' && <><Choice id="synth-wave" label="Oscillator" value={instrument.waveform ?? 'sawtooth'} options={['sine','triangle','sawtooth','square'].map(value => ({ value,label:value }))} disabled={busy} onChange={value => change({ ...instrument,waveform:value as OscillatorType })} /><div className="synth-controls">{controls.map(([id,label,min,max,step]) => <NumberField key={id} label={label} value={instrument.parameters[id] ?? defaultInstrument().parameters[id]} min={min} max={max} step={step} disabled={busy} onChange={value => parameter(id,value)} />)}</div></>}
    {banks.length > 0 && <Choice id="soundfont-bank" label="SoundFont library" value={instrument.soundfontId ?? ''} options={[{ value:'',label:'Select a bank' },...banks.map(a => ({ value:a.id,label:a.name }))]} disabled={busy} onChange={chooseBank} />}
    {instrument.type === 'soundfont' && <Choice id="soundfont-preset" label="Preset" value={`${instrument.bank ?? 0}:${instrument.program ?? 0}`} options={presets.map((p) => ({ value:`${p.bank}:${p.program}`,label:`${p.bank}:${p.program} · ${p.name}` }))} disabled={busy} onChange={value => { const [bank,program] = value.split(':').map(Number); change({ ...instrument,bank,program }); }} />}
    {instrument.type === 'soundfont' && <p className="field-note">SF2 / SF3 · Live keys and rendered playback.</p>}
    <input type="file" hidden ref={sfInput} accept=".sf2,.sf3" aria-label="Load SoundFont" onChange={event => { const file = event.target.files?.[0]; if (file) run('Loading SoundFont',() => session.loadSoundfont(track.id,file)); event.target.value = ''; }} />
    {showHost && <div className="native-host-panel"><strong><Cable size={13} />Local VST3 host</strong><p className="field-note">Run the companion in native-host, then paste its session token. VST3 phrases render when you press Play.</p><label className="text-field"><span>Host session token</span><input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label><button className="button" disabled={busy || !token} onClick={() => run('Connecting native host',async () => { nativeHost.token = token.trim(); setPlugins(await nativeHost.plugins()); if (instrument.pluginId) setParameters(await nativeHost.parameters(instrument.pluginId)); })}><Cable size={13} />Connect / refresh</button><Choice id="vst-plugin" label="Installed instrument" value={instrument.pluginId ?? ''} options={[{ value:'',label:plugins.length ? 'Select instrument' : 'Connect to list plugins' },...plugins.map(p => ({ value:p.id,label:p.name }))]} disabled={busy} onChange={id => { if (id) choosePlugin(id); }} /></div>}
    {instrument.type === 'vst3' && <><p className="field-note">{instrument.pluginName} · Native render</p>{parameters.length > 0 ? <><input className="parameter-search" placeholder="Find a parameter…" aria-label="Find plugin parameter" value={query} onChange={e => setQuery(e.target.value)} /><div className="plugin-parameters">{parameters.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).map(p => <NumberField key={p.id} label={`${p.name}${p.label ? ` · ${p.label}` : ''}`} value={instrument.parameters[p.id] ?? p.value} min={0} max={1} step={.001} disabled={busy} onChange={value => parameter(p.id,value)} />)}</div><p className="field-note">Normalized values, 0–1. Saved with the project.</p></> : <button className="button" disabled={busy} onClick={() => { setShowHost(true); if (nativeHost.token) choosePlugin(instrument.pluginId!); }}><Upload size={13} />Load parameters</button>}</>}
  </div>;
}
