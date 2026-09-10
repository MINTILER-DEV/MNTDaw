// A generated sine sample with one preset; no third-party audio or bank license needed.
export function sineSoundfont() {
  const name = (text: string, length = 20) => {
    const bytes = Buffer.alloc(length);
    bytes.write(text);
    return bytes;
  };
  const word = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    return b;
  };
  const dword = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const join = (...bytes: Uint8Array[]) => Buffer.concat(bytes);
  const chunk = (tag: string, data: Uint8Array) =>
    join(
      name(tag, 4),
      dword(data.length),
      data,
      ...(data.length % 2 ? [Buffer.alloc(1)] : []),
    );
  const list = (tag: string, ...chunks: Uint8Array[]) =>
    chunk('LIST', join(name(tag, 4), ...chunks));
  const frames = 2205;
  const sample = Buffer.alloc((frames + 46) * 2);
  for (let i = 0; i < frames; i++)
    sample.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / 22050) * 12000),
      i * 2,
    );
  const preset = (label: string, bag: number) =>
    join(name(label), word(0), word(0), word(bag), Buffer.alloc(12));
  const instrument = (label: string, bag: number) =>
    join(name(label), word(bag));
  const sampleHeader = join(
    name('Sine'),
    dword(0),
    dword(frames),
    dword(8),
    dword(frames - 8),
    dword(22050),
    Buffer.from([69, 0]),
    word(0),
    word(1),
  );
  const body = join(
    name('sfbk', 4),
    list(
      'INFO',
      chunk('ifil', join(word(2), word(1))),
      chunk('INAM', name('MNT test bank')),
    ),
    list('sdta', chunk('smpl', sample)),
    list(
      'pdta',
      chunk('phdr', join(preset('Sine', 0), preset('EOP', 1))),
      chunk('pbag', join(word(0), word(0), word(1), word(0))),
      chunk('pmod', Buffer.alloc(10)),
      chunk('pgen', join(word(41), word(0), Buffer.alloc(4))),
      chunk('inst', join(instrument('Sine', 0), instrument('EOI', 1))),
      chunk('ibag', join(word(0), word(0), word(1), word(0))),
      chunk('imod', Buffer.alloc(10)),
      chunk('igen', join(word(53), word(0), Buffer.alloc(4))),
      chunk('shdr', join(sampleHeader, join(name('EOS'), Buffer.alloc(26)))),
    ),
  );
  return Uint8Array.from(chunk('RIFF', body)).buffer;
}
