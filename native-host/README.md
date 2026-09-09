# MNT native VST3 host

This optional companion loads installed **VST3 instruments** using Spotify's Pedalboard and renders MIDI clips to audio. It is an offline instrument host, not a low-latency live VST3 engine or a native plugin editor. The browser's live keyboard supports the built-in synth and SoundFonts. VST3 playback prepares the audio through this host first.

Use Python 3.10–3.13 with a Pedalboard wheel for your OS and architecture:

```sh
python -m venv .venv
# Windows:
.venv\Scripts\python -m pip install -r native-host/requirements.txt
.venv\Scripts\python native-host/server.py
```

For a Vercel deployment, pass its exact origin:

```sh
python native-host/server.py --origin https://your-project.vercel.app --plugin-dir "C:/Program Files/Common Files/VST3"
```

Select an instrument track in MNT, choose **VST3 · native host**, paste the pairing token from the host console, and connect. Choose a discovered plugin. Its exposed parameters are editable as normalized 0–1 values and are saved in the project. Play prepares each MIDI clip through the selected plugin. Changed notes, tempo, or parameters invalidate that clip's render cache. Native plugin paths, binaries, external sample libraries, proprietary preset blobs, and the pairing token are not embedded in `.mnt` files. The same plugin must be installed when reopening the project.

The host binds only to loopback, requires an exact allowed Origin and a per-run token, and only loads plugins discovered in the configured folders. Plugins run in isolated subprocesses with a timeout. A VST3 plugin is native software: only install plugins you trust. No upload endpoint accepts native code. Requests are limited to 4 MB, 8192 notes, and 5 minutes of audio.

Browsers may request local-network permission or block a hosted HTTPS page from reaching a local HTTP service. If blocked, run the DAW locally or use a trusted local HTTPS setup. No VST3 server code runs on Vercel. Plugin compatibility varies; native plugin UIs and live MIDI streaming are not provided in this version.

References: [Pedalboard instrument rendering](https://spotify.github.io/pedalboard/reference/pedalboard.html#pedalboard.VST3Plugin), [parameter raw values](https://spotify.github.io/pedalboard/reference/pedalboard.html#pedalboard.AudioProcessorParameter).
