import type { ModelDefinition } from "./model-catalog";
import { schemaDefaults } from "./model-schemas";
import { assetSegmentToTimelineRegion, regionToSourceSeconds } from "./region";
import { segmentsForSpeaker } from "./transcript";
import { normalizeTrackOrder } from "./track-ops";
import type { Asset, Clip, ProjectSnapshot, Region, Track, TranscriptSegment } from "./types";

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function formatTime(sec: number): string {
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function defaultSnapshot(id = "project_default", name = "Untitled audio system"): ProjectSnapshot {
  const stamp = now();
  const project = {
    id,
    name,
    sampleRate: 48000,
    createdAt: stamp,
    updatedAt: stamp
  };
  const tracks: Track[] = [
    { id: "track_voice", projectId: project.id, kind: "voice", name: "Voice", gain: 1, muted: false, solo: false, order: 0 },
    { id: "track_music", projectId: project.id, kind: "music", name: "Music", gain: 0.82, muted: false, solo: false, order: 1 },
    { id: "track_sfx", projectId: project.id, kind: "sfx", name: "SFX", gain: 0.9, muted: false, solo: false, order: 2 }
  ];
  return { project, tracks: normalizeTrackOrder(tracks), clips: [], assets: [], voices: [], jobs: [], promptDrafts: [], modelRuns: [] };
}

export function defaultsFor(model: ModelDefinition): Record<string, string | number | boolean> {
  return schemaDefaults(model.id);
}

export function firstTrack(snapshot: ProjectSnapshot, kind: Track["kind"] = "voice"): string {
  const tracks = normalizeTrackOrder(snapshot.tracks);
  return tracks.find((track) => track.kind === kind)?.id ?? tracks[0].id;
}

export function buildOutputName(model: ModelDefinition, input: Record<string, unknown>): string {
  const text = String(input.prompt ?? input.text ?? input.style ?? model.label);
  return text.trim().slice(0, 42) || model.label;
}

export function requestedOutputDuration(input: Record<string, unknown>): number {
  const value = Number(input.seconds_total ?? input.duration ?? input.add_seconds);
  return Number.isFinite(value) && value > 0 ? value : 8;
}

export function snapSecond(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

export function clipUsesEditedSource(clip: Clip, asset: Asset): boolean {
  return clip.offset > 0.05 || clip.duration < Math.max(0, asset.duration - clip.offset) - 0.05;
}

export function orderedRegion(a: number, b: number): Region {
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

// Drops UI-only (`__`-prefixed) and empty-string keys before an input leaves the client.
export function publicInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => !key.startsWith("__") && value !== "")
  );
}

// Clamp the timeline selection to the selected clip and map it back to a source-local clip.
// Returns undefined when there is no overlapping selection worth acting on (<0.1s).
export function regionClipFor(
  selectedClip: Clip | undefined,
  selection: { trackId: string; start: number; end: number } | null
): Clip | undefined {
  if (!selectedClip || !selection || selection.trackId !== selectedClip.trackId) return undefined;
  const range = {
    start: Math.max(selection.start, selectedClip.start),
    end: Math.min(selection.end, selectedClip.start + selectedClip.duration)
  };
  if (range.end - range.start < 0.1) return undefined;
  const sourceRegion = regionToSourceSeconds(selectedClip, range);
  return {
    ...selectedClip,
    start: 0,
    offset: sourceRegion.start,
    duration: sourceRegion.end - sourceRegion.start
  };
}

export interface SpeakerBlock {
  segment: TranscriptSegment;
  timelineRegion: Region;
  sourceRegion: Region;
}

// Transcript segments for one speaker that fall inside the selected clip, mapped to
// both timeline and source-local seconds. Empty when no clip is selected.
export function speakerBlocksFor(
  selectedClip: Clip | undefined,
  transcript: TranscriptSegment[],
  speaker: string
): SpeakerBlock[] {
  if (!selectedClip) return [];
  return segmentsForSpeaker(transcript, speaker)
    .map((segment) => {
      const timelineRegion = assetSegmentToTimelineRegion(selectedClip, segment);
      if (!timelineRegion) return undefined;
      const sourceRegion = regionToSourceSeconds(selectedClip, timelineRegion);
      return { segment, timelineRegion, sourceRegion };
    })
    .filter((item): item is SpeakerBlock => Boolean(item));
}
