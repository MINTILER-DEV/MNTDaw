import { SoundBankLoader } from 'spessasynth_core';

export const inspectSoundfont = (bytes: ArrayBuffer) =>
  SoundBankLoader.fromArrayBuffer(bytes).presets.map((preset) => ({
    name: preset.name,
    program: preset.program,
    bank: preset.bankMSB * 128 + preset.bankLSB,
  }));
