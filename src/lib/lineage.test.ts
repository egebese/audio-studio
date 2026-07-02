import { describe, expect, it } from "vitest";
import { createDerivedAsset } from "./lineage";
import type { Asset } from "./types";

describe("lineage", () => {
  it("creates a new derived asset without mutating the source", () => {
    const source: Asset = {
      id: "asset_1",
      projectId: "project",
      kind: "audio",
      name: "Source",
      url: "source.wav",
      duration: 4,
      source: "upload",
      createdAt: "now"
    };
    const derived = createDerivedAsset(source, {
      id: "asset_2",
      url: "next.wav",
      duration: 5,
      modelId: "seed-restyle",
      operation: "restyle",
      params: { style: "whisper" },
      createdAt: "later"
    });

    expect(derived.id).not.toBe(source.id);
    expect(derived.derivedFrom?.assetId).toBe(source.id);
    expect(source.derivedFrom).toBeUndefined();
  });
});
