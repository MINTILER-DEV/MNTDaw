# MNT — core audio workspace

A minimal, responsive web DAW foundation built with React, TypeScript, Vite, and the Web Audio API. WAV files are decoded locally and never uploaded. No backend or environment variables are required.

## Run locally

Use Node.js 22.13+ (Node.js 24 recommended).

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Import a WAV and press play. Space toggles play/pause; Escape stops and resets. Click the waveform or drag the timeline to seek. Keyboard shortcuts do not override focused form controls.

## Included

- Single WAV import by file picker or drag and drop, with real peak waveforms and source metadata.
- Play, pause/resume, stop, return to start, and seek using the audio context's clock.
- Master volume from −60 to +6 dB, mute, stereo post-gain peak meters, and a resettable clipping indicator.
- Output device discovery/selection where `AudioContext.setSinkId` is available, including fallback to the system default if a selected device disappears.
- Requested engine sample rate (device default, 44.1, 48, 88.2, or 96 kHz) and buffer/latency targets (128–2048 samples).
- Actual context sample rate and browser-reported processing/output latency.
- Accessible icon labels, keyboard sliders, responsive layouts, and reduced-motion support.

## Deploy on Vercel

1. Push this project to your Git provider and import it as a Vercel project.
2. Choose **Vite** if it is not automatically detected.
3. Use **`npm run build`** as the build command and **`dist`** as the output directory. `vercel.json` already sets these values.
4. Deploy. No secrets, server functions, database, or special environment variables are needed.

Alternatively, run `npx vercel` from this directory after signing in to your Vercel account. This repository is prepared for deployment; it is not linked to a Vercel account or deployed automatically.

References: [Vercel's Vite deployment guide](https://vercel.com/docs/frameworks/frontend/vite), [Vite static deployments](https://vite.dev/guide/static-deploy).

## Browser behavior

- Audio starts on a user action. Opening a file does not automatically play it.
- Output selection requires HTTPS or localhost and browser support for [`AudioContext.setSinkId`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId). The Connect action uses the browser's output chooser if available. Otherwise it briefly requests microphone permission to reveal device labels, immediately stops every microphone track, and never records or connects microphone audio. Browsers without output switching use the system output.
- Web Audio does **not** expose a portable hardware buffer-size control. The selected sample count is translated into [`AudioContextOptions.latencyHint`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext), which the browser may ignore. Reported latency is displayed independently. The device-default rate uses the previous rate, or 48 kHz, to calculate the initial hint.
- Sample rate controls the context. The browser handles resampling during decoding/playback and may resample again to the hardware rate. Source WAV metadata remains distinct from the engine rate. Unsupported settings produce an error while preserving the existing audio graph.
- Changing engine settings replaces the context and resumes at the retained position. This may cause a short gap; it is not a gapless device reconfiguration.
- Imports support standard RIFF/WAVE files containing PCM or float audio that the browser can decode. Maximum encoded file size is 150 MB; a decoded-memory guard also applies. RF64 and compressed WAV codecs are not supported. Multichannel files are mixed to stereo for the master output; the waveform shows the first two channels.
- Meters are sampled peak meters, not true-peak or loudness meters. +6 dB can clip. Click the clipping readout to reset the indicator.
- Files and sessions are in memory. Reloading clears them. This first system intentionally does not include recording, multitrack editing, plugins, or project saving.

## Development

```sh
npm test
npm run lint
npm run build
npm start
```

`lib/audio-engine.ts` owns transport, the audio graph, output routing, and context lifecycle. `lib/audio-utils.ts` contains WAV header validation, peak extraction, and unit conversions. `app/page.tsx` subscribes to the engine and provides the workspace UI.

The unit suite exercises transport timing, stale async playback cancellation, failed imports/settings, output routing failures, context replacement, WAV validation, and transient-preserving waveforms using a deterministic AudioContext test double. Hardware routing, actual audible output, and device permission prompts need testing on the target browser and audio device.
