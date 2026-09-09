export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  frames: number;
};

export function parseWav(bytes: ArrayBuffer): WavInfo {
  const view = new DataView(bytes);
  const tag = (offset: number) =>
    String.fromCharCode(...new Uint8Array(bytes, offset, 4));
  if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Choose a valid RIFF/WAVE file (.wav).');
  }
  let format: Omit<WavInfo, 'frames'> | undefined;
  let blockAlign = 0;
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.byteLength)
      throw new Error('This WAV is incomplete or damaged.');
    if (tag(offset) === 'fmt ') {
      if (size < 16) throw new Error('This WAV has an invalid format header.');
      const encoding = view.getUint16(start, true);
      if (![1, 3, 65534].includes(encoding))
        throw new Error('Use an uncompressed PCM or floating-point WAV.');
      format = {
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bitDepth: view.getUint16(start + 14, true),
      };
      blockAlign = view.getUint16(start + 12, true);
    }
    if (tag(offset) === 'data') dataSize += size;
    offset = start + size + (size % 2);
  }
  if (
    !format ||
    !format.channels ||
    !format.sampleRate ||
    !blockAlign ||
    !dataSize
  ) {
    throw new Error('This WAV has no readable audio samples.');
  }
  if (dataSize % blockAlign !== 0)
    throw new Error('This WAV has incomplete audio frames.');
  const frames = dataSize / blockAlign;
  if (frames * format.channels * 4 > 384 * 1024 * 1024)
    throw new Error(
      'This WAV is too large to decode. Try a shorter audio file.',
    );
  return { ...format, frames };
}

export function formatTime(seconds: number, precise = false) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const whole = Math.floor(safe % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${whole}${
    precise
      ? `.${Math.floor((safe % 1) * 1000)
          .toString()
          .padStart(3, '0')}`
      : ''
  }`;
}

export const dbToGain = (db: number) => 10 ** (db / 20);
export const gainToDb = (gain: number) =>
  gain > 0 ? 20 * Math.log10(gain) : -Infinity;

// Preserve transients rather than sampling isolated points from the recording.
export function waveformPeaks(samples: Float32Array, count = 720) {
  const peaks: [number, number][] = [];
  for (let bin = 0; bin < count; bin++) {
    const start = Math.floor((bin * samples.length) / count);
    const end = Math.max(
      start + 1,
      Math.floor(((bin + 1) * samples.length) / count),
    );
    let min = 0,
      max = 0;
    for (let i = start; i < Math.min(end, samples.length); i++) {
      min = Math.min(min, samples[i]);
      max = Math.max(max, samples[i]);
    }
    peaks.push([min, max]);
  }
  return peaks;
}
