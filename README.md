# MNT Studio - MIDI workspace

A web DAW built with React, TypeScript, Vite, and the Web Audio API. Arrange audio and MIDI clips, play instruments, and save a portable project file. Audio is processed locally. The synth and SoundFont workflow needs no backend or environment variables. VST3 instruments use the optional local native companion.

## Run locally

Use Node.js 22.13+ (Node.js 24 recommended).

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Import WAV/MP3 files, or add an instrument track using the piano icon, double-click its lane to create a MIDI clip, and draw notes. Space toggles play/pause; Escape stops and resets. Click the bar ruler or an empty lane, or drag the position slider, to seek. Focused form controls keep their normal keyboard behavior.

## Included

- A DAW window with a project title bar, transport, audio library, scrollable arrangement, track headers, clip inspector, master output, and fullscreen control.
- Named projects with a versioned `.mnt` file format, save/open, unsaved-change prompts, and 50 steps of undo/redo.
- Add, rename, and remove tracks; per-track volume, mute, solo, and master routing.
- Import multiple WAVs or MP3s by file picker or drag and drop. Imports onto a selected track are placed sequentially from the playhead; imports onto new tracks share a start position.
- Drag clips along the timeline or between tracks, snap to beats, trim either edge, duplicate, delete, or edit precise start/offset/duration values in the inspector.
- Context menus on tracks, audio/MIDI clips, and notes: cut, copy, paste, duplicate, and delete. Track menus also import audio. Drag the bottom edge of a track header to resize it, or focus the handle and use up/down arrows.
- A piano roll with pitch, velocity, start, note length, note dragging/resizing, quantized drawing, and live computer/Web MIDI keyboard capture. MIDI file import creates instrument tracks and follows the current project tempo.
- A built-in polyphonic oscillator synth with waveform, attack, decay, sustain, release, cutoff, resonance, and detune controls.
- SF2/SF3 bank loading, preset selection, live audition, and offline rendered playback.
- Optional local VST3 instrument hosting with exposed parameter controls and rendered playback; see [native host setup](native-host/README.md).
- Reuse audio from the project library without embedding duplicate copies in the project file.
- Tempo from 20–300 BPM, editable time signatures, tempo-change and signature-change markers, a bars/beats/ticks display (960 ticks per beat), an elapsed-time display, and timeline zoom.
- Play, pause/resume, stop, return to start, and seek using the audio context's clock.
- Master volume from −60 to +6 dB, mute, stereo post-gain peak meters, and a resettable clipping indicator.
- Output device discovery/selection where `AudioContext.setSinkId` is available, including fallback to the system default if a selected device disappears.
- Requested engine sample rate (device default, 44.1, 48, 88.2, or 96 kHz) and buffer/latency targets (128–2048 samples).
- Actual context sample rate and browser-reported processing/output latency.
- Accessible icon labels, keyboard sliders, responsive layouts, and reduced-motion support.

## Project files and editing

**Save project** (Ctrl/Cmd+S) downloads a `.mnt` project copy. **Open project** (Ctrl/Cmd+O) restores it. The file includes project name and ID, tempo, playhead position, master settings, track settings, clip timing, MIDI notes and instruments, time signatures and BPM markers, track heights, and original WAV/MP3/SoundFont bytes encoded in JSON. New saves use version 2; version 1 audio projects remain readable. It can move between computers without missing-file relinking. This is a download-based workflow, not an overwrite-in-place file editor or an autosave service. Reloading clears the in-memory session, so download a copy before leaving.

Projects support 64 tracks, 128 media files, 2048 clips, and 96 MB of embedded audio/SoundFont data, with an additional decoded-memory limit. Project files are limited to 140 MB. New projects start with two empty audio tracks and a 16-bar timeline; the timeline expands to fit the arrangement. Blank regions and muted tracks still advance the playhead.

Clip starts and MIDI note timing use zero-based quarter-note beats (beat 0 is bar 1); audio source offsets and durations use seconds. MIDI clips support 8192 notes and 4096 beats each. A signature marker begins a new bar at its beat, truncating the previous bar if necessary; it does not move existing clips. The signature display counts beats using the selected denominator. Tempo markers change BPM instantly from their beat onward. Clip starts stay anchored to their beats; the tempo map determines their time in seconds. Editing the map retains the musical playhead position. Notes crossing a tempo change follow each segment, including SoundFont and VST3 phrase renders. Audio clip widths and waveform positions follow the tempo map. WAVs play at their original speed: this version does not perform time-stretching. Overlapping clips are mixed, including overlaps on the same track. Trimming is nondestructive. Undoing track/clip deletion retains the source audio.

Project opening validates the document, asset references, media bytes, MIDI ranges, instrument references, and clip source boundaries before replacing the current session. Unsupported, corrupt, or incomplete files leave the existing project intact. Opening a project does not autoplay. Output-device selection and audio-engine preferences stay specific to the current browser/device and are not part of the project file.

### Shortcuts

| Action                   | Shortcut                       |
| ------------------------ | ------------------------------ |
| Play / pause             | Space                          |
| Stop and return to start | Escape                         |
| Download project copy    | Ctrl/Cmd+S                     |
| Open project             | Ctrl/Cmd+O                     |
| Undo                     | Ctrl/Cmd+Z                     |
| Redo                     | Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y |
| Nudge a focused clip     | Left/right arrows              |
| Remove selection         | Delete or Backspace            |
| Cut / copy / paste       | Ctrl/Cmd+X / C / V             |
| Duplicate selection      | Ctrl/Cmd+D                     |

Drag a library file to a lane, or double-click it to insert at the playhead on the selected track. The library button also supports Enter. Drag either clip edge to trim; use the inspector for keyboard-accessible precise editing.

## MIDI and instruments

1. Click the piano icon next to **Track** to add an instrument track. Its default instrument is the built-in synth.
2. Double-click an empty instrument lane, or use **MIDI clip** in the inspector/context menu. Double-click the clip to open the piano roll.
3. Click empty grid space to draw a note; drag empty space to box-select existing notes. Ctrl/Cmd-click toggles individual notes, Ctrl/Cmd+A selects all, and Ctrl/Cmd/Shift-drag adds to the selection. Drag selected notes to move the group, or a right edge to resize it. Arrow keys nudge the group. Velocity applies to the selection; pitch, start, and length controls adjust the group relative to the last-selected note. Right-click for edit actions.
4. Enable **Keys** to play `A W S E D F T G Y H U J K` (C through C in the selected octave). Enable **Capture** to write incoming notes to the selected clip. When stopped, notes enter at the editor cursor and advance on release; during playback they use the playhead. This is basic quantized capture, not a full recording/take system.
5. Click **MIDI input** to request Web MIDI access, then select your hardware input. Permission and browser support are required. The on-screen keys and computer keyboard work without Web MIDI. **All notes off**, losing window focus, disconnecting an input, or closing the editor releases held notes.
6. Use the instrument inspector to edit the synth, load an `.sf2`/`.sf3` bank, or pair the native VST3 companion. SoundFont banks embed in the project; plugins and external plugin sample libraries stay on your computer.

SoundFont and VST3 playback renders each phrase before starting and caches the result. Changes to notes, instruments, or tempo invalidate the cache; editing an uncached rendered phrase during playback pauses transport until Play prepares it again. Renders use stereo 48 kHz, include a two-second release tail, allow at most five minutes including that tail per clip, and cap cached rendered audio at 384 MB. The synth and SoundFonts support live keys. VST3 currently supports offline phrase rendering and normalized 0 to 1 parameters, without a native plugin editor, live MIDI streaming, parameter automation, or proprietary preset-state saving. Native plugin compatibility must be checked with your installed instruments.

The transport signature button edits the initial signature. Use the **+ signature** button above the track headers to add a change at the playhead. Right-click the ruler to add a tempo or signature change at the mouse position, using the arrangement snap setting. The dashed hover guide shows that same snapped position over the ruler and tracks; clicking an empty lane seeks there. The **+ BPM** button adds a tempo change at the playhead. Click an existing marker to edit its position and value; right-click to remove it. Tempo and signature markers can share a position. The transport BPM field displays and edits the active tempo segment. All marker changes support undo/redo and project save/load. MIDI file imports retain notes and dynamics at the project tempo; imported tempo maps, signature maps, sustain/controllers, and program changes are not imported yet.

### Note clipboard, zoom, and splitting

- Copy/paste selected notes with the editor's icons, context menu, or Ctrl/Cmd+C and Ctrl/Cmd+V. The note clipboard works across MIDI clips in the current project. Pasting retains relative timing, lengths, pitches, and velocities. Ctrl/Cmd+D duplicates the group; Ctrl/Cmd+X moves it to the clipboard; Delete removes it. Undo restores each group edit in one step.
- Paste starts at the live transport playhead, translated into the open clip's local beats. With Grid enabled, the first note snaps forward to the next grid line (or stays on the current line). With Grid Off, it uses the exact playhead. Pasting extends the clip to fit the phrase, up to 4096 beats, and never shifts it backward to fit. Before the clip start, paste begins at local beat zero. Right-click or Ctrl/Cmd-click empty space still positions the note drawing cursor.
- Use the piano-roll zoom buttons, Ctrl/Cmd+wheel, or Ctrl/Cmd+plus/minus while the editor has focus. Click the percentage or use Ctrl/Cmd+0 to reset. Zoom ranges from 25% to 400% and keeps the visible center in place.
- Split a selected WAV, MP3, or MIDI clip using the scissors button, **Split clip at playhead** in its context menu, or Ctrl/Cmd+B in the arrangement. Alt-click directly on a clip to split at the pointer. Arrangement snap applies to both methods; disable it for finer cuts. Splits must be inside a clip, and MIDI fragments must be at least 1/64 note long.
- Audio splits reuse the original media with contiguous source offsets. MIDI splits retain notes on their respective sides; a note crossing the split becomes two notes and retriggers at the boundary. Splits are undoable and saved in the project. **Cut to clipboard** remains a separate action.

### Clip edges, playheads, and snap

Drag a clip's left or right edge to shorten or extend it. Audio trims reuse the original file: the left edge cannot reveal audio before source time zero, and the right edge cannot go past the file's end. Left-edge trimming keeps the clip's end fixed. MIDI clips can extend to 4096 quarter-note beats; shortening them crops notes at the new edges, and Undo restores the removed notes. Extending a MIDI clip adds empty space. Double-click anywhere in a MIDI clip's miniature note display to open its piano roll.

The piano roll has its own ruler and bright playhead, synchronized to the main project position. Its beat 1 corresponds to the MIDI clip's start in the arrangement; the playhead hides when the main position is outside the clip. Drag the ruler or bright playhead in either view to seek the same transport. The piano ruler/playhead also supports arrow keys, Home, and End. The faint piano-grid line remains the note drawing cursor; pasting uses the bright transport playhead.

Choose the arrangement snap division beside the magnet button, and the piano roll division in its Grid control. Both offer whole through 1/64 notes and quarter/eighth-note triplets. Turn off the arrangement magnet or choose Off in the piano roll for free positioning. Snap divisions affect clip positioning, edge trims, splits, note edits, and playhead dragging in the corresponding view.

## Deploy on Vercel

1. Push this project to your Git provider and import it as a Vercel project.
2. Choose **Vite** if it is not automatically detected.
3. Use **`npm run build`** as the build command and **`dist`** as the output directory. `vercel.json` already sets these values.
4. Deploy. No secrets, server functions, database, or special environment variables are needed.

Alternatively, run `npx vercel` from this directory after signing in to your Vercel account. A linked Vercel Git integration can deploy pushes automatically; the application itself does not require any account connection.

References: [Vercel's Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite), [Vite static deployments](https://vite.dev/guide/static-deploy).

## Browser behavior

- Audio starts on a user action. Opening a file does not automatically play it.
- Output selection requires HTTPS or localhost and browser support for [`AudioContext.setSinkId`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId). The Connect action uses the browser's output chooser if available. Otherwise it briefly requests microphone permission to reveal device labels, immediately stops every microphone track, and never records or connects microphone audio. Browsers without output switching use the system output.
- Web Audio does **not** expose a portable hardware buffer-size control. The selected sample count is translated into [`AudioContextOptions.latencyHint`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext), which the browser may ignore. Reported latency is displayed independently. The device-default rate uses the previous rate, or 48 kHz, to calculate the initial hint.
- Sample rate controls the context. The browser handles resampling during decoding/playback and may resample again to the hardware rate. Source WAV metadata remains distinct from the engine rate. Unsupported settings produce an error while preserving the existing audio graph.
- Changing engine settings replaces the context and resumes at the retained position. This may cause a short gap; it is not a gapless device reconfiguration.
- Imports support standard RIFF/WAVE files containing PCM or float audio that the browser can decode, within the project-wide limits above. MP3 is also supported where the browser decoder provides it. RF64 and compressed WAV codecs are not supported. Multichannel files are mixed to stereo for the master output; each clip shows a waveform of the first channel.
- Meters are sampled peak meters, not true-peak or loudness meters. +6 dB can clip. Click the clipping readout to reset the indicator.
- Audio recording, time-stretching, final audio export, MIDI controller automation, and native plugin editors are not included. Web MIDI access requires a secure context and browser support; check the in-app result on your target browser.

## Development

```sh
npm test
python -m unittest discover -s native-host -p "test_*.py"
npm run lint
npm run build
npm start
```

`lib/audio-engine.ts` owns transport, multitrack scheduling, the audio graph, output routing, and context lifecycle. A silent buffer source marks the arrangement boundary, so transport also works across gaps. `lib/project.ts` defines and validates the file format. `lib/project-session.ts` owns editing, history, media, and transactional import/open. `lib/audio-utils.ts` contains WAV validation, waveform peaks, and unit conversions. `app/daw.tsx` provides the arrangement UI; `components/daw-controls.tsx` contains the shared controls and audio settings.

The unit suite exercises project round-trips, exact embedded WAV preservation, schema failures, clip boundaries, undo/redo, transactional imports, tempo changes, simultaneous scheduling, seeking across overlaps, silent gaps, mixer routing, context replacement, and the original core audio behavior using a deterministic AudioContext test double. MIDI tests cover scheduling, envelopes, concurrent live voices, clipboard isolation, file import, format compatibility, signature arithmetic, and a generated SF2 bank round-trip. Native host tests cover pairing, CORS, bundle discovery, and validation without loading native code. Hardware MIDI/output, browser SoundFont rendering, SF3 decoding, actual installed VST3 rendering, audible output, and permission prompts still need testing on the target browser and audio device.

Instrument dependencies: [SpessaSynth documentation](https://spessasus.github.io/spessasynth_lib/) (SF2/SF3 synthesis, Apache-2.0), [Tone.js MIDI](https://github.com/Tonejs/Midi) (MIDI files, MIT), and the optional [Pedalboard instrument API](https://spotify.github.io/pedalboard/reference/pedalboard.html) (native VST3, GPL-3.0). No commercial SoundFonts or plugins are bundled.

Drag the grip along the piano roll's top edge up or down to resize the editor. Its height is retained when switching clips or closing and reopening the roll during the session. The editor stays within the available workspace and leaves the arrangement visible. Focus the grip and use Up/Down to resize (Shift for larger steps), Home/End for minimum/maximum height, and Enter or double-click to reset.
