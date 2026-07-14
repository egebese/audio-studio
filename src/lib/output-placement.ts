import type { TrackKind } from "./types";

// Placement for model outputs. Three modes, per the editor's core behavior:
//  - "replace-region" (inpaint): the repair replaces the gap IN PLACE — studio splits the
//    source clip at the gap and inserts the repair on the same track. The source ASSET is
//    untouched (clip surgery only), so the edit stays reversible from Project media.
//  - "same-track-after" (extend): butt-joined right after the source clip on the SAME track,
//    never overlapping (studio resolves the final start with placeWithoutOverlap).
//  - "lane-below" (dub / restyle / voice-change / takes): an aligned take on a dedicated lane
//    directly BELOW the source track.
// The planner is pure so the start/offset/duration math is unit-testable; studio.tsx
// materializes tracks and clips from the returned plan.

export type PlacementMode = "lane-below" | "same-track-after" | "replace-region";

export interface TransformPlacement {
  mode: PlacementMode;
  /** Track name to find-or-create (lane-below mode only). */
  trackLabel?: string;
  trackKind: TrackKind;
  /** Timeline start (seconds) the clip should sit at. */
  start: number;
  /** Offset into the output asset (seconds) — non-zero only when trimming to a gap. */
  offset: number;
  duration: number;
  /** Seam crossfade against the surrounding audio (seconds). */
  fadeIn: number;
  fadeOut: number;
}

export interface TransformPlacementArgs {
  operation: string;
  sourceClipStart: number;
  sourceClipDuration: number;
  sourceTrackKind: TrackKind;
  /** Selected region in timeline coords, or null when the whole clip is the source. */
  regionStart: number | null;
  regionEnd: number | null;
  outputDuration: number;
  /** Gap window in output-local seconds (inpaint) — from input.gap_start_s/gap_end_s. */
  gapStart?: number;
  gapEnd?: number;
  /** Language for the dub lane label. */
  languageLabel?: string;
  crossfade?: number;
}

function roundSecond(value: number): number {
  return Math.round(value * 10) / 10;
}

export function planTransformPlacement(args: TransformPlacementArgs): TransformPlacement {
  const xfade = args.crossfade ?? 0;
  const hasRegion =
    args.regionStart != null && args.regionEnd != null && args.regionEnd - args.regionStart > 0.05;
  const regionStart = hasRegion ? (args.regionStart as number) : args.sourceClipStart;
  const outputDuration = roundSecond(Math.max(0.25, args.outputDuration));

  if (args.operation === "extend") {
    // Continuation: butt-joined after the source end on the same track, no overlap.
    const start = Math.max(0, roundSecond(args.sourceClipStart + args.sourceClipDuration));
    return { mode: "same-track-after", trackKind: args.sourceTrackKind, start, offset: 0, duration: outputDuration, fadeIn: 0, fadeOut: 0 };
  }

  if (args.operation === "inpaint") {
    // Repair: trimmed to the gap window and swapped into the gap in place, faded at both seams.
    const gapStart = Math.max(0, args.gapStart ?? 0);
    const gapEnd = args.gapEnd ?? gapStart + args.outputDuration;
    const duration = roundSecond(Math.max(0.25, gapEnd - gapStart));
    return { mode: "replace-region", trackKind: args.sourceTrackKind, start: roundSecond(regionStart), offset: roundSecond(gapStart), duration, fadeIn: xfade, fadeOut: xfade };
  }

  if (args.operation === "dub") {
    const label = args.languageLabel ? `Dub — ${args.languageLabel}` : "Dub";
    return { mode: "lane-below", trackLabel: label, trackKind: args.sourceTrackKind, start: roundSecond(regionStart), offset: 0, duration: outputDuration, fadeIn: xfade, fadeOut: 0 };
  }

  // restyle, voice-change, stable-audio-to-audio, and any other transform: an aligned take.
  const label =
    args.operation === "voice-change" ? "Voice Changer" : args.operation === "restyle" ? "Restyle" : "Take";
  return { mode: "lane-below", trackLabel: label, trackKind: args.sourceTrackKind, start: roundSecond(regionStart), offset: 0, duration: outputDuration, fadeIn: xfade, fadeOut: 0 };
}
