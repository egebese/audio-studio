import type { Clip, Region } from "./types";

const minClipDuration = 0.25;

function roundSecond(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function moveClipBy(clip: Clip, deltaSeconds: number): Clip {
  return { ...clip, start: roundSecond(Math.max(0, clip.start + deltaSeconds)) };
}

export function trimClipStartBy(clip: Clip, assetDuration: number, deltaSeconds: number): Clip {
  const sourceEnd = Math.min(assetDuration, clip.offset + clip.duration);
  const maxOffset = Math.max(0, sourceEnd - minClipDuration);
  let offset = clamp(clip.offset + deltaSeconds, 0, maxOffset);

  if (clip.start + offset - clip.offset < 0) {
    offset = Math.max(0, clip.offset - clip.start);
  }

  return {
    ...clip,
    start: roundSecond(Math.max(0, clip.start + offset - clip.offset)),
    offset: roundSecond(offset),
    duration: roundSecond(Math.max(minClipDuration, sourceEnd - offset))
  };
}

export function trimClipEndBy(clip: Clip, assetDuration: number, deltaSeconds: number): Clip {
  const maxDuration = Math.max(minClipDuration, assetDuration - clip.offset);
  return {
    ...clip,
    duration: roundSecond(clamp(clip.duration + deltaSeconds, minClipDuration, maxDuration))
  };
}

export function cutClipRegionToGap(clip: Clip, region: Region, nextId: () => string): Clip[] {
  const cutStart = clamp(region.start, clip.start, clip.start + clip.duration);
  const cutEnd = clamp(region.end, clip.start, clip.start + clip.duration);
  if (cutEnd - cutStart < minClipDuration) return [clip];

  const beforeDuration = roundSecond(cutStart - clip.start);
  const afterDuration = roundSecond(clip.start + clip.duration - cutEnd);
  const next: Clip[] = [];

  if (beforeDuration >= minClipDuration) {
    next.push({ ...clip, duration: beforeDuration });
  }
  if (afterDuration >= minClipDuration) {
    next.push({
      ...clip,
      id: next.length ? nextId() : clip.id,
      start: roundSecond(cutEnd),
      offset: roundSecond(clip.offset + cutEnd - clip.start),
      duration: afterDuration
    });
  }

  return next;
}
