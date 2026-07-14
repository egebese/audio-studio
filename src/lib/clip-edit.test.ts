import { describe, expect, it } from "vitest";
import { cutClipRegionToGap, moveClipBy, placeWithoutOverlap, snapStart, splitClipAt, trailingWindow, trimClipEndBy, trimClipStartBy } from "./clip-edit";
import type { Clip } from "./types";

describe("trailingWindow", () => {
  const long: Clip = { id: "c", trackId: "t", assetId: "a", start: 0, duration: 90, offset: 0, gain: 1, fadeIn: 0, fadeOut: 0 };
  it("keeps a short clip untouched", () => {
    const short = { ...long, duration: 20 };
    expect(trailingWindow(short, 28)).toEqual(short);
  });
  it("windows a long clip to its trailing slice", () => {
    const w = trailingWindow(long, 28);
    expect(w.duration).toBe(28);
    expect(w.offset).toBe(62);
    expect(w.start).toBe(62);
  });
});

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

describe("placeWithoutOverlap rounding", () => {
  it("does not round back into the occupied slot", () => {
    const occupied: Clip[] = [
      { id: "src", trackId: "t", assetId: "a", start: 0, duration: 69.14, offset: 0, gain: 1, fadeIn: 0, fadeOut: 0 }
    ];
    const start = placeWithoutOverlap(occupied, "t", 69.1, 18);
    expect(start).toBeGreaterThanOrEqual(69.14); // butt joint, zero overlap
  });
});

describe("splitClipAt", () => {
  const source: Clip = { id: "clip", trackId: "t", assetId: "a", start: 4, duration: 10, offset: 2, gain: 1, fadeIn: 0, fadeOut: 0 };

  it("splits into two source-continuous clips at the playhead", () => {
    const [left, right] = splitClipAt(source, 9, () => "right");
    expect(left).toMatchObject({ id: "clip", start: 4, offset: 2, duration: 5 });
    expect(right).toMatchObject({ id: "right", start: 9, offset: 7, duration: 5 });
  });

  it("refuses sliver splits near the edges", () => {
    expect(splitClipAt(source, 4.1, () => "x")).toEqual([source]);
    expect(splitClipAt(source, 13.9, () => "x")).toEqual([source]);
    expect(splitClipAt(source, 2, () => "x")).toEqual([source]);
  });
});

describe("placeWithoutOverlap", () => {
  const lane = (start: number, duration: number, id: string): Clip => ({
    ...clip,
    id,
    start,
    duration
  });

  it("keeps the desired start on an empty track", () => {
    expect(placeWithoutOverlap([], "track", 3, 4)).toBe(3);
  });

  it("ignores clips on other tracks", () => {
    const other = { ...lane(0, 10, "other"), trackId: "elsewhere" };
    expect(placeWithoutOverlap([other], "track", 2, 4)).toBe(2);
  });

  it("uses an exact-fit gap between clips", () => {
    const clips = [lane(0, 4, "a"), lane(8, 4, "b")];
    expect(placeWithoutOverlap(clips, "track", 4, 4)).toBe(4);
  });

  it("cascades past several overlapping clips", () => {
    const clips = [lane(0, 4, "a"), lane(4, 4, "b"), lane(8, 2, "c")];
    expect(placeWithoutOverlap(clips, "track", 1, 3)).toBe(10);
  });

  it("shifts a start that lands inside an existing clip", () => {
    const clips = [lane(5, 4, "a")];
    expect(placeWithoutOverlap(clips, "track", 6, 2)).toBe(9);
  });
});

describe("snapStart", () => {
  it("snaps the start edge to a nearby candidate", () => {
    expect(snapStart(4.85, 2, [5], 0.3)).toBe(5);
  });

  it("snaps the end edge to a nearby candidate", () => {
    expect(snapStart(2.8, 2, [5], 0.3)).toBe(3);
  });

  it("leaves the start alone when nothing is within threshold", () => {
    expect(snapStart(4.5, 2, [10], 0.3)).toBe(4.5);
  });

  it("prefers the nearest candidate", () => {
    expect(snapStart(4.9, 2, [5, 4.7], 0.3)).toBe(5);
  });
});
