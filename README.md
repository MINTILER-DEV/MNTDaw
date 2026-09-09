# MNT Studio — project workspace

A web DAW built with React, TypeScript, Vite, and the Web Audio API. Arrange WAV clips on audio tracks, set a tempo, and save a portable project file. Audio is processed locally. No backend or environment variables are required.

## Run locally

Use Node.js 22.13+ (Node.js 24 recommended).

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Import WAVs, arrange clips, and press play. Space toggles play/pause; Escape stops and resets. Click the bar ruler or an empty lane, or drag the position slider, to seek. Focused form controls keep their normal keyboard behavior.

## Included

- A DAW window with a project title bar, transport, audio library, scrollable arrangement, track headers, clip inspector, master output, and fullscreen control.
- Named projects with a versioned `.mnt` file format, save/open, unsaved-change prompts, and 50 steps of undo/redo.
- Add, rename, and remove tracks; per-track volume, mute, solo, and master routing.
- Import multiple WAVs by file picker or drag and drop. Imports onto a selected track are placed sequentially from the playhead; imports onto new tracks share a start position.
- Drag clips along the timeline or between tracks, snap to beats, trim the right edge, duplicate, delete, or edit precise start/offset/duration values in the inspector.
- Reuse audio from the project library without embedding duplicate copies in the project file.
- Tempo from 20–300 BPM, 4/4 bars and beats, a bars/beats/ticks display (960 ticks per beat), an elapsed-time display, and timeline zoom.
- Play, pause/resume, stop, return to start, and seek using the audio context's clock.
- Master volume from −60 to +6 dB, mute, stereo post-gain peak meters, and a resettable clipping indicator.
- Output device discovery/selection where `AudioContext.setSinkId` is available, including fallback to the system default if a selected device disappears.
- Requested engine sample rate (device default, 44.1, 48, 88.2, or 96 kHz) and buffer/latency targets (128–2048 samples).
- Actual context sample rate and browser-reported processing/output latency.
- Accessible icon labels, keyboard sliders, responsive layouts, and reduced-motion support.

## Project files and editing

**Save project** (Ctrl/Cmd+S) downloads a `.mnt` project copy. **Open project** (Ctrl/Cmd+O) restores it. The file includes project name and ID, tempo, playhead position, master settings, track settings, clip timing, and original WAV bytes encoded in JSON. It can move between computers without missing-file relinking. This is a download-based workflow, not an overwrite-in-place file editor or an autosave service. Reloading clears the in-memory session, so download a copy before leaving.

Projects support 64 tracks, 128 audio files, 2048 clips, and 96 MB of embedded WAV data, with an additional decoded-memory limit. Project files are limited to 140 MB. New projects start with two empty audio tracks and a 16-bar timeline; the timeline expands to fit the arrangement. Blank regions and muted tracks still advance the playhead.

Clip starts use zero-based beats (beat 0 is bar 1); source offsets and durations use seconds. Tempo changes move clip starts on the grid and retain the musical playhead position. WAVs play at their original speed: this version does not perform time-stretching. Overlapping clips are mixed, including overlaps on the same track. Trimming is nondestructive. Undoing track/clip deletion retains the source audio.

Project opening validates the document, asset references, WAV bytes, and clip source boundaries before replacing the current session. Unsupported, corrupt, or incomplete files leave the existing project intact. Opening a project does not autoplay. Output-device selection and audio-engine preferences stay specific to the current browser/device and are not part of the project file.

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
| Remove selected clip     | Delete or Backspace            |

Drag a library file to a lane, or double-click it to insert at the playhead on the selected track. The library button also supports Enter. Drag the clip's right edge to trim; use the inspector for keyboard-accessible precise editing.

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
- Imports support standard RIFF/WAVE files containing PCM or float audio that the browser can decode, within the project-wide limits above. RF64 and compressed WAV codecs are not supported. Multichannel files are mixed to stereo for the master output; each clip shows a waveform of the first channel.
- Meters are sampled peak meters, not true-peak or loudness meters. +6 dB can clip. Click the clipping readout to reset the indicator.
- Recording, plugins, time-stretching, alternative time signatures, and final audio export are not included in this project-system version.

## Development

```sh
npm test
npm run lint
npm run build
npm start
```

`lib/audio-engine.ts` owns transport, multitrack scheduling, the audio graph, output routing, and context lifecycle. A silent buffer source marks the arrangement boundary, so transport also works across gaps. `lib/project.ts` defines and validates the file format. `lib/project-session.ts` owns editing, history, media, and transactional import/open. `lib/audio-utils.ts` contains WAV validation, waveform peaks, and unit conversions. `app/daw.tsx` provides the arrangement UI; `components/daw-controls.tsx` contains the shared controls and audio settings.

The unit suite exercises project round-trips, exact embedded WAV preservation, schema failures, clip boundaries, undo/redo, transactional imports, tempo changes, simultaneous scheduling, seeking across overlaps, silent gaps, mixer routing, context replacement, and the original core audio behavior using a deterministic AudioContext test double. Hardware routing, actual audible output, and device permission prompts still need testing on the target browser and audio device.
