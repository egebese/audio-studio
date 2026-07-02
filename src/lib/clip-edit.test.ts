import { describe, expect, it } from "vitest";
import { cutClipRegionToGap, moveClipBy, trimClipEndBy, trimClipStartBy } from "./clip-edit";
import type { Clip } from "./types";

const clip: Clip = {
  id: "clip",
  trackId: "track",
  assetId: "asset",
  start: 5,
  duration: 4,
  offset: 2,
  gain: 1,
  fadeIn: 0,
  fadeOut: 0
};

describe("clip editing", () => {
  it("moves clips without crossing zero", () => {
    expect(moveClipBy(clip, 1.24).start).toBe(6.2);
    expect(moveClipBy(clip, -10).start).toBe(0);
  });

  it("trims and extends the clip start against source audio", () => {
    expect(trimClipStartBy(clip, 10, 1)).toMatchObject({ start: 6, offset: 3, duration: 3 });
    expect(trimClipStartBy(clip, 10, -1)).toMatchObject({ start: 4, offset: 1, duration: 5 });
  });

  it("trims and extends the clip end against source audio", () => {
    expect(trimClipEndBy(clip, 10, -1)).toMatchObject({ duration: 3 });
    expect(trimClipEndBy(clip, 10, 20)).toMatchObject({ duration: 8 });
  });

  it("cuts a timeline region into a gap while preserving source offsets", () => {
    const [before, after] = cutClipRegionToGap(clip, { start: 6, end: 7 }, () => "after");

    expect(before).toMatchObject({ id: "clip", start: 5, offset: 2, duration: 1 });
    expect(after).toMatchObject({ id: "after", start: 7, offset: 4, duration: 2 });
  });
});
