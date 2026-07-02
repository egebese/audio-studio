import { getModel } from "./model-catalog";
import type { Asset, ModelRun, TrackKind } from "./types";

function producedTrackKind(asset: Asset, modelRuns: ModelRun[]): TrackKind | undefined {
  const run = modelRuns.find((item) => item.outputAssetIds.includes(asset.id));
  return run ? getModel(run.modelId)?.defaultTrack : undefined;
}

export function isWhisperBlockedAsset(asset: Asset, modelRuns: ModelRun[] = []): boolean {
  if (asset.source !== "generated") return false;
  const kind = asset.trackKind ?? producedTrackKind(asset, modelRuns);
  return kind === "music" || kind === "sfx";
}
