import { describe, expect, it } from "vitest";
import { isWhisperBlockedAsset } from "./asset-rules";
import type { Asset, ModelRun } from "./types";

const asset: Asset = {
  id: "asset",
  projectId: "project",
  kind: "audio",
  name: "generated.wav",
  url: "generated.wav",
  duration: 4,
  source: "generated",
  createdAt: "now"
};

describe("asset rules", () => {
  it("blocks Whisper for generated music and sfx assets", () => {
    expect(isWhisperBlockedAsset({ ...asset, trackKind: "music" })).toBe(true);
    expect(isWhisperBlockedAsset({ ...asset, trackKind: "sfx" })).toBe(true);
    expect(isWhisperBlockedAsset({ ...asset, trackKind: "voice" })).toBe(false);
  });

  it("uses model run history for older generated assets", () => {
    const runs: ModelRun[] = [
      {
        id: "run",
        jobId: "job",
        modelId: "stable-audio",
        operation: "music",
        input: {},
        outputAssetIds: ["asset"],
        createdAt: "now"
      }
    ];

    expect(isWhisperBlockedAsset(asset, runs)).toBe(true);
  });

  it("allows uploaded music or sfx references", () => {
    expect(isWhisperBlockedAsset({ ...asset, source: "upload", trackKind: "music" })).toBe(false);
  });
});
