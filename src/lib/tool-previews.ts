// Turns a tool-preview manifest (written by scripts/run-tool-previews.mjs) into
// per-tool ProjectSnapshots so every model result can be inspected on the timeline.
// Pure so the layout math is unit-testable; studio.tsx probes durations and saves.

import { getModel } from "./model-catalog";
import { now } from "./studio-helpers";
import type { Asset, Clip, DiarizationSegment, ProjectSnapshot, Track, TranscriptSegment } from "./types";

export interface PreviewMedia {
  url?: string;
  name?: string;
  duration?: number;
  transcript?: string;
  transcriptSegments?: TranscriptSegment[];
  diarizationSegments?: DiarizationSegment[];
}

export interface ToolPreviewEntry {
  toolId: string;
  label: string;
  status: "done" | "error";
  error?: string;
  elapsedS?: number;
  params?: Record<string, unknown>;
  source?: PreviewMedia;
  voice?: PreviewMedia;
  output?: PreviewMedia;
}

export interface ToolPreviewManifest {
  createdAt: string;
  entries: ToolPreviewEntry[];
}

export function previewMediaUrls(manifest: ToolPreviewManifest): string[] {
  const urls = manifest.entries.flatMap((entry) =>
    [entry.source?.url, entry.voice?.url, entry.output?.url].filter((url): url is string => Boolean(url))
  );
  return [...new Set(urls)];
}

const fallbackDuration = 8;

export function buildPreviewSnapshot(
  entry: ToolPreviewEntry,
  durations: Record<string, number>
): ProjectSnapshot | undefined {
  if (entry.status !== "done") return undefined;

  const stamp = now();
  const projectId = `preview_${entry.toolId}`;
  const durationOf = (media: PreviewMedia) =>
    media.duration || (media.url ? durations[media.url] : 0) || fallbackDuration;

  const tracks: Track[] = [];
  const assets: Asset[] = [];
  const clips: Clip[] = [];
  const baseClip = { offset: 0, gain: 1, fadeIn: 0, fadeOut: 0 };

  let sourceAsset: Asset | undefined;
  let sourceDuration = 0;
  if (entry.source?.url) {
    sourceDuration = durationOf(entry.source);
    sourceAsset = {
      id: `${projectId}_src`,
      projectId,
      kind: "audio",
      trackKind: "voice",
      name: entry.source.name ?? "Source",
      url: entry.source.url,
      duration: sourceDuration,
      source: "upload",
      createdAt: stamp,
      // Whisper writes onto the source asset; other tools leave it untouched.
      transcript: entry.output?.transcript && !entry.output.url ? entry.output.transcript : entry.source.transcript,
      transcriptSegments:
        entry.output?.transcriptSegments && !entry.output.url
          ? entry.output.transcriptSegments
          : entry.source.transcriptSegments,
      diarizationSegments:
        entry.output?.diarizationSegments && !entry.output.url
          ? entry.output.diarizationSegments
          : entry.source.diarizationSegments
    };
    assets.push(sourceAsset);
    tracks.push({ id: `${projectId}_track_src`, projectId, kind: "voice", name: "Source", gain: 1, muted: false, solo: false, order: 0 });
    clips.push({ ...baseClip, id: `${projectId}_clip_src`, trackId: `${projectId}_track_src`, assetId: sourceAsset.id, start: 0, duration: sourceDuration });
  }

  if (entry.voice?.url) {
    const duration = durationOf(entry.voice);
    const asset: Asset = {
      id: `${projectId}_voice`,
      projectId,
      kind: "audio",
      trackKind: "voice",
      name: entry.voice.name ?? "Voice ref",
      url: entry.voice.url,
      duration,
      source: "upload",
      createdAt: stamp
    };
    assets.push(asset);
    tracks.push({ id: `${projectId}_track_voice`, projectId, kind: "voice", name: "Voice ref", gain: 1, muted: true, solo: false, order: tracks.length });
    clips.push({ ...baseClip, id: `${projectId}_clip_voice`, trackId: `${projectId}_track_voice`, assetId: asset.id, start: 0, duration });
  }

  if (entry.output?.url) {
    const model = getModel(entry.toolId);
    const duration = durationOf(entry.output);
    const asset: Asset = {
      id: `${projectId}_out`,
      projectId,
      kind: "audio",
      trackKind: model?.defaultTrack ?? "voice",
      name: entry.output.name ?? `${entry.label} output`,
      url: entry.output.url,
      duration,
      source: "generated",
      createdAt: stamp,
      transcript: entry.output.transcript,
      transcriptSegments: entry.output.transcriptSegments,
      diarizationSegments: entry.output.diarizationSegments,
      derivedFrom: sourceAsset
        ? { assetId: sourceAsset.id, modelId: entry.toolId, operation: model?.task ?? entry.toolId, params: entry.params ?? {} }
        : undefined
    };
    assets.push(asset);
    tracks.push({
      id: `${projectId}_track_out`,
      projectId,
      kind: model?.defaultTrack ?? "voice",
      name: "Result",
      gain: 1,
      muted: false,
      solo: false,
      order: tracks.length
    });
    clips.push({
      ...baseClip,
      id: `${projectId}_clip_out`,
      trackId: `${projectId}_track_out`,
      assetId: asset.id,
      // Extend continues after the source; everything else lines up for A/B at 0.
      start: entry.toolId === "seed-extend" ? sourceDuration : 0,
      duration
    });
  }

  if (!assets.length) return undefined;

  return {
    project: { id: projectId, name: `TOOL — ${entry.label}`, sampleRate: 48000, createdAt: stamp, updatedAt: stamp },
    tracks,
    clips,
    assets,
    voices: [],
    jobs: [],
    promptDrafts: [],
    modelRuns: []
  };
}
