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
    bars.push({ beat, bar: bar++, signature });
    beat = Math.min(
      beat + barBeats(signature),
      changes[index]?.beat ?? Infinity,
    );
  }
  return bars;
}
export function signaturePosition(
  beat: number,
  signature: Signature,
  markers: SignatureMarker[] = [],
) {
  const bars = signatureBars(signature, markers, beat);
  const current = bars.at(-1)!;
  const local = (Math.max(0, beat - current.beat) * current.signature[1]) / 4;
  return `${String(current.bar).padStart(3, '0')}.${Math.floor(local) + 1}.${String(Math.floor((local % 1) * 960)).padStart(3, '0')}`;
}
