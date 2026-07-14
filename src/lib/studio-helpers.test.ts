import { describe, expect, it } from "vitest";
import { publicInput, regionClipFor, speakerBlocksFor } from "./studio-helpers";
import type { Clip, TranscriptSegment } from "./types";

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip1",
    trackId: "track1",
    assetId: "asset1",
    start: 0,
    duration: 10,
    offset: 0,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...overrides
  };
}

describe("publicInput", () => {
  it("drops __-prefixed and empty-string keys, keeps 0/false", () => {
    expect(publicInput({ prompt: "hi", __ui: "x", empty: "", zero: 0, off: false })).toEqual({
      prompt: "hi",
      zero: 0,
      off: false
    });
  });
});

describe("regionClipFor", () => {
  it("maps a clamped selection back to source-local offset/duration", () => {
    const c = clip({ start: 2, duration: 10, offset: 1 });
    const result = regionClipFor(c, { trackId: "track1", start: 4, end: 8 });
    expect(result).toMatchObject({ start: 0, offset: 3, duration: 4 });
  });

  it("returns undefined for null selection, wrong track, or sub-0.1s overlap", () => {
    const c = clip({ start: 2, duration: 10, offset: 1 });
    expect(regionClipFor(c, null)).toBeUndefined();
    expect(regionClipFor(c, { trackId: "other", start: 4, end: 8 })).toBeUndefined();
    expect(regionClipFor(c, { trackId: "track1", start: 4, end: 4.05 })).toBeUndefined();
    expect(regionClipFor(undefined, { trackId: "track1", start: 4, end: 8 })).toBeUndefined();
  });
});

describe("speakerBlocksFor", () => {
  const segments: TranscriptSegment[] = [
    { id: "s1", start: 1, end: 3, text: "hey", speaker: "A" },
    { id: "s2", start: 4, end: 6, text: "ho", speaker: "B" }
  ];

  it("returns only the requested speaker's blocks with timeline+source regions", () => {
    const blocks = speakerBlocksFor(clip(), segments, "A");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].segment.id).toBe("s1");
    expect(blocks[0].timelineRegion).toEqual({ start: 1, end: 3 });
    expect(blocks[0].sourceRegion).toEqual({ start: 1, end: 3 });
  });

  it("returns [] when no clip is selected", () => {
    expect(speakerBlocksFor(undefined, segments, "A")).toEqual([]);
  });
});
