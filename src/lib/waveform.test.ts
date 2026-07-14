import { describe, expect, it } from "vitest";
import { bucketPeaks } from "./waveform";

describe("bucketPeaks", () => {
  it("returns the max absolute sample per bucket", () => {
    const channel = new Float32Array([0.1, -0.9, 0.2, 0.3, -0.05, 0.4]);
    expect(bucketPeaks(channel, 3)).toEqual([Math.fround(0.9), Math.fround(0.3), Math.fround(0.4)]);
  });

  it("handles empty input and zero buckets", () => {
    expect(bucketPeaks(new Float32Array(0), 10)).toEqual([]);
    expect(bucketPeaks(new Float32Array([0.5]), 0)).toEqual([]);
  });

  it("caps bucket count at sample count", () => {
    const peaks = bucketPeaks(new Float32Array([0.5, -0.25]), 10);
    expect(peaks.length).toBeLessThanOrEqual(10);
    expect(peaks[0]).toBe(0.5);
  });
});
