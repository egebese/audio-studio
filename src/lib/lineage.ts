import type { Asset, DerivedFrom } from "./types";

export function createDerivedAsset(
  source: Asset,
  next: {
    id: string;
    name?: string;
    url: string;
    duration: number;
    modelId: string;
    operation: string;
    params: Record<string, unknown>;
    jobId?: string;
    createdAt: string;
  }
): Asset {
  const derivedFrom: DerivedFrom = {
    assetId: source.id,
    modelId: next.modelId,
    operation: next.operation,
    params: next.params,
    jobId: next.jobId
  };

  return {
    id: next.id,
    projectId: source.projectId,
    kind: "audio",
    name: next.name ?? `${source.name} / ${next.operation}`,
    url: next.url,
    duration: next.duration,
    source: "derived",
    createdAt: next.createdAt,
    derivedFrom
  };
}
