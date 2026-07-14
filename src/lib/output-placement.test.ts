import { describe, expect, it } from "vitest";
import { planTransformPlacement, type TransformPlacementArgs } from "./output-placement";

const base: TransformPlacementArgs = {
  operation: "restyle",
  sourceClipStart: 10,
  sourceClipDuration: 8,
  sourceTrackKind: "voice",
  regionStart: null,
  regionEnd: null,
  outputDuration: 8
};

describe("planTransformPlacement", () => {
  it("extend butt-joins after the source end on the same track, no overlap fades", () => {
    const p = planTransformPlacement({ ...base, operation: "extend", outputDuration: 15, crossfade: 0.06 });
    expect(p.mode).toBe("same-track-after");
    expect(p.trackLabel).toBeUndefined();
    expect(p.start).toBe(18); // 10 + 8, butt joint
    expect(p.offset).toBe(0);
    expect(p.fadeIn).toBe(0);
  });

  it("inpaint replaces the gap in place, trimmed to the gap window", () => {
    const p = planTransformPlacement({
      ...base,
      operation: "inpaint",
      regionStart: 13,
      regionEnd: 15,
      gapStart: 3,
      gapEnd: 5,
      outputDuration: 8,
      crossfade: 0.02
    });
    expect(p.mode).toBe("replace-region");
    expect(p.start).toBe(13);
    expect(p.offset).toBe(3);
    expect(p.duration).toBe(2);
    expect(p.fadeIn).toBeCloseTo(0.02);
    expect(p.fadeOut).toBeCloseTo(0.02);
  });

  it("dub lands at the source start on a language lane below", () => {
    const p = planTransformPlacement({ ...base, operation: "dub", languageLabel: "Chinese", outputDuration: 9 });
    expect(p.mode).toBe("lane-below");
    expect(p.trackLabel).toBe("Dub — Chinese");
    expect(p.start).toBe(10);
    expect(p.duration).toBe(9);
  });

  it("restyle with a region aligns to the region start", () => {
    const p = planTransformPlacement({ ...base, operation: "restyle", regionStart: 12, regionEnd: 14, outputDuration: 2 });
    expect(p.mode).toBe("lane-below");
    expect(p.trackLabel).toBe("Restyle");
    expect(p.start).toBe(12);
  });

  it("whole-clip restyle aligns to the source clip start", () => {
    const p = planTransformPlacement({ ...base, operation: "restyle", outputDuration: 8 });
    expect(p.start).toBe(10);
    expect(p.offset).toBe(0);
  });

  it("keeps the source track kind for the new lane", () => {
    const p = planTransformPlacement({ ...base, operation: "restyle", sourceTrackKind: "music" });
    expect(p.trackKind).toBe("music");
  });
});
