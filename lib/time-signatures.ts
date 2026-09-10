export type Signature = [number, number];
export type SignatureMarker = {
  id: string;
  beat: number;
  signature: Signature;
};
export const barBeats = (signature: Signature) =>
  (signature[0] * 4) / signature[1];
export function validateSignature(value: unknown): Signature {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !Number.isInteger(value[0]) ||
    value[0] < 1 ||
    value[0] > 32 ||
    ![1, 2, 4, 8, 16, 32].includes(value[1])
  )
    throw new Error('Invalid time signature.');
  return [value[0], value[1]];
}
export function signatureBars(
  initial: Signature,
  markers: SignatureMarker[],
  end: number,
  minimumSpacing = 0,
) {
  const changes = [...markers].sort((a, b) => a.beat - b.beat);
  const bars: { beat: number; bar: number; signature: Signature }[] = [];
  let beat = 0,
    bar = 1,
    signature = initial,
    index = 0;
  while (beat < end + 0.00001 && bars.length < 100000) {
    while (index < changes.length && changes[index].beat <= beat + 0.00001)
      signature = changes[index++].signature;
    bars.push({ beat, bar, signature });
    const size = barBeats(signature);
    const nextChange = changes[index]?.beat ?? Infinity;
    const stride = Math.min(
      Math.max(1, Math.ceil(minimumSpacing / size)),
      Math.ceil((nextChange - beat) / size - 1e-9),
    );
    bar += stride;
    beat = Math.min(beat + size * stride, nextChange);
  }
  return bars;
}
export function signaturePosition(
  beat: number,
  signature: Signature,
  markers: SignatureMarker[] = [],
) {
  beat = Math.max(0, beat);
  let cursor = 0,
    bar = 1;
  for (const marker of [...markers].sort((a, b) => a.beat - b.beat)) {
    if (marker.beat > beat) break;
    bar += Math.ceil((marker.beat - cursor) / barBeats(signature) - 1e-9);
    cursor = marker.beat;
    signature = marker.signature;
  }
  const fullBars = Math.floor((beat - cursor) / barBeats(signature) + 1e-9);
  bar += fullBars;
  const local = Math.max(
    0,
    ((beat - cursor - fullBars * barBeats(signature)) * signature[1]) / 4,
  );
  return `${String(bar).padStart(3, '0')}.${Math.floor(local) + 1}.${String(Math.floor((local % 1) * 960)).padStart(3, '0')}`;
}
