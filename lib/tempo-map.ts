export type TempoMarker = { id: string; beat: number; tempo: number };
export type TempoSource =
  | number
  | { tempo: number; tempoMarkers?: TempoMarker[] };

function segments(source: TempoSource) {
  return typeof source === 'number'
    ? []
    : [...(source.tempoMarkers ?? [])].sort((a, b) => a.beat - b.beat);
}

export function tempoAtBeat(beat: number, source: TempoSource) {
  let tempo = typeof source === 'number' ? source : source.tempo;
  for (const marker of segments(source)) {
    if (marker.beat > beat) break;
    tempo = marker.tempo;
  }
  return tempo;
}

export function beatsToSeconds(beat: number, source: TempoSource): number {
  let tempo = typeof source === 'number' ? source : source.tempo;
  let previous = 0,
    seconds = 0;
  for (const marker of segments(source)) {
    if (marker.beat > beat) break;
    seconds += ((marker.beat - previous) * 60) / tempo;
    previous = marker.beat;
    tempo = marker.tempo;
  }
  return seconds + ((beat - previous) * 60) / tempo;
}

export function secondsToBeats(seconds: number, source: TempoSource): number {
  let tempo = typeof source === 'number' ? source : source.tempo;
  let previous = 0,
    elapsed = 0;
  for (const marker of segments(source)) {
    const boundary = elapsed + ((marker.beat - previous) * 60) / tempo;
    if (boundary > seconds) break;
    elapsed = boundary;
    previous = marker.beat;
    tempo = marker.tempo;
  }
  return previous + ((seconds - elapsed) * tempo) / 60;
}

export function beatDuration(
  start: number,
  length: number,
  source: TempoSource,
): number {
  if (length < 0) return -beatDuration(start + length, -length, source);
  const end = start + length;
  let tempo = tempoAtBeat(start, source),
    previous = start,
    duration = 0;
  for (const marker of segments(source)) {
    if (marker.beat <= start) continue;
    if (marker.beat >= end) break;
    duration += ((marker.beat - previous) * 60) / tempo;
    previous = marker.beat;
    tempo = marker.tempo;
  }
  return duration + ((end - previous) * 60) / tempo;
}

/** Client coordinates and the ruler's scroll-aware bounding rectangle. */
export function rulerBeatAt(
  clientX: number,
  rulerLeft: number,
  zoom: number,
  length: number,
) {
  return Math.max(0, Math.min(length, (clientX - rulerLeft) / zoom));
}

/** Place uniformly sampled audio peaks on a beat grid without stretching audio. */
export function audioPeakBeats(
  start: number,
  duration: number,
  count: number,
  source: TempoSource,
) {
  const markers = segments(source).filter((marker) => marker.beat > start);
  let beat = start,
    elapsed = 0,
    tempo = tempoAtBeat(start, source),
    next = 0;
  return Array.from({ length: count }, (_, i) => {
    const time = ((i + 0.5) * duration) / count;
    while (next < markers.length) {
      const marker = markers[next];
      const boundary = elapsed + ((marker.beat - beat) * 60) / tempo;
      if (boundary > time) break;
      beat = marker.beat;
      elapsed = boundary;
      tempo = marker.tempo;
      next++;
    }
    return beat + ((time - elapsed) * tempo) / 60 - start;
  });
}
