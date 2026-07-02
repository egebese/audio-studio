import type { Clip, Region, TranscriptSegment } from "./types";

export function regionToSourceSeconds(clip: Clip, region: Region): Region {
  const start = Math.max(0, region.start - clip.start + clip.offset);
  const end = Math.max(start, region.end - clip.start + clip.offset);
  return { start, end };
}

export function regionToClipSeconds(clip: Clip, region: Region): Region {
  const start = Math.max(0, Math.min(clip.duration, region.start - clip.start));
  const end = Math.max(start, Math.min(clip.duration, region.end - clip.start));
  return { start, end };
}

export function assetSegmentToTimelineRegion(clip: Clip, segment: TranscriptSegment): Region | undefined {
  const start = Math.max(clip.start, clip.start + segment.start - clip.offset);
  const end = Math.min(clip.start + clip.duration, clip.start + segment.end - clip.offset);
  return end > start ? { start, end } : undefined;
}
