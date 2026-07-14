import { describe, it, expect } from "vitest";
import { DUCK_DB, duckGain, frameLevel, median } from "./loudness";

describe("frameLevel", () => {
  it("measures the loud level of a steady tone (RMS of a 0.5 sine ≈ 0.354)", () => {
    const sr = 48000;
    const s = new Float32Array(sr);
    for (let i = 0; i < s.length; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr);
    const level = frameLevel(s, sr);
    expect(level).toBeGreaterThan(0.3);
    expect(level).toBeLessThan(0.4);
  });

  it("returns 0 for silence", () => {
    expect(frameLevel(new Float32Array(4800), 48000)).toBe(0);
  });
});

describe("duckGain", () => {
  it("makes the bed play offsetDb under the voice", () => {
    const V = 0.03;
    const bed = 0.1;
    const gain = duckGain(V, bed, 16);
    const playedDb = 20 * Math.log10((bed * gain) / V);
    expect(playedDb).toBeCloseTo(-16, 0);
  });

  it("is a no-op (gain 1) when either level is unknown", () => {
    expect(duckGain(0, 0.1, 16)).toBe(1);
    expect(duckGain(0.03, 0, 16)).toBe(1);
  });

  it("ducks sfx further under the voice than music (larger offset → smaller gain)", () => {
    expect(duckGain(0.03, 0.1, DUCK_DB.sfx)).toBeLessThan(duckGain(0.03, 0.1, DUCK_DB.music));
  });
});

describe("median", () => {
  it("ignores zeros and empty", () => {
    expect(median([0, 0.02, 0.04])).toBe(0.04);
    expect(median([])).toBe(0);
  });
});
