import { describe, expect, it } from "vitest";
import { assetSegmentToTimelineRegion, regionToClipSeconds, regionToSourceSeconds } from "./region";

describe("region mapping", () => {
  it("maps timeline seconds into source-buffer seconds", () => {
    expect(
      regionToSourceSeconds(
        {
          id: "clip",
          trackId: "track",
          assetId: "asset",
          start: 10,
          duration: 8,
          offset: 3,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0
        },
        { start: 12, end: 16 }
      )
    ).toEqual({ start: 5, end: 9 });
  });

  it("maps timeline seconds into rendered clip seconds", () => {
    expect(
      regionToClipSeconds(
        {
          id: "clip",
          trackId: "track",
          assetId: "asset",
          start: 10,
          duration: 8,
          offset: 3,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0
        },
        { start: 12, end: 16 }
      )
    ).toEqual({ start: 2, end: 6 });
  });

  it("maps asset-local transcript segments into timeline seconds", () => {
    expect(
      assetSegmentToTimelineRegion(
        {
          id: "clip",
          trackId: "track",
          assetId: "asset",
          start: 10,
          duration: 8,
          offset: 3,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0
        },
        { id: "seg", start: 5, end: 7, text: "hello" }
      )
    ).toEqual({ start: 12, end: 14 });
  });
});
