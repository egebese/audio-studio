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

// Trailing window of a clip (e.g. the last ~28s) for Seed reference limits — Extend/voice
// context only needs recent audio, so the head is dropped instead of rejecting the whole clip.
export function trailingWindow(clip: Clip, maxSeconds: number): Clip {
  if (clip.duration <= maxSeconds) return clip;
  const trim = roundSecond(clip.duration - maxSeconds);
  return {
    ...clip,
    start: roundSecond(clip.start + trim),
    offset: roundSecond(clip.offset + trim),
    duration: roundSecond(maxSeconds)
  };
}

export function placeWithoutOverlap(
  clips: Clip[],
  trackId: string,
  desiredStart: number,
  duration: number
): number {
  const laneClips = clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.start - b.start);
  let start = Math.max(0, desiredStart);

  for (const clip of laneClips) {
    const clipEnd = clip.start + clip.duration;
    if (clipEnd <= start) continue;
    if (clip.start >= start + duration) break;
    start = clipEnd;
  }

  // Never round back INTO the slot we just cleared (e.g. 69.14 → 69.1 would overlap).
  const rounded = roundSecond(start);
  return rounded >= start ? rounded : start;
}

export function snapStart(
  proposedStart: number,
  duration: number,
  edges: number[],
  threshold: number
): number {
  let best = proposedStart;
  let bestDistance = threshold;

  for (const edge of edges) {
    const startDistance = Math.abs(edge - proposedStart);
    if (startDistance < bestDistance) {
      bestDistance = startDistance;
      best = edge;
    }
    const endDistance = Math.abs(edge - (proposedStart + duration));
    if (endDistance < bestDistance) {
      bestDistance = endDistance;
      best = edge - duration;
    }
  }

  return roundSecond(Math.max(0, best));
}

// Micro-fade applied to fresh cut edges so butt joints do not click.
const seamFade = 0.02;

// Splits a clip in two at a timeline position (e.g. the playhead). Returns the
// original clip untouched when the cut would leave a sliver shorter than 0.25s.
export function splitClipAt(clip: Clip, atSeconds: number, nextId: () => string): Clip[] {
  const local = atSeconds - clip.start;
  if (local < minClipDuration || clip.duration - local < minClipDuration) return [clip];
  return [
    { ...clip, duration: roundSecond(local), fadeOut: Math.max(clip.fadeOut, seamFade) },
    {
      ...clip,
      id: nextId(),
      start: roundSecond(atSeconds),
      offset: roundSecond(clip.offset + local),
      duration: roundSecond(clip.duration - local),
      fadeIn: seamFade
    }
  ];
}

export function cutClipRegionToGap(clip: Clip, region: Region, nextId: () => string): Clip[] {
  const cutStart = clamp(region.start, clip.start, clip.start + clip.duration);
  const cutEnd = clamp(region.end, clip.start, clip.start + clip.duration);
  if (cutEnd - cutStart < minClipDuration) return [clip];

  const beforeDuration = roundSecond(cutStart - clip.start);
  const afterDuration = roundSecond(clip.start + clip.duration - cutEnd);
  const next: Clip[] = [];

  if (beforeDuration >= minClipDuration) {
    next.push({ ...clip, duration: beforeDuration, fadeOut: Math.max(clip.fadeOut, seamFade) });
  }
  if (afterDuration >= minClipDuration) {
    next.push({
      ...clip,
      id: next.length ? nextId() : clip.id,
      start: roundSecond(cutEnd),
      offset: roundSecond(clip.offset + cutEnd - clip.start),
      duration: afterDuration,
      fadeIn: seamFade
    });
  }

  return next;
}
