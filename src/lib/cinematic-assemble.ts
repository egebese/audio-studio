// Pure in-app assembly: turn generated + measured parts into a ProjectSnapshot. It
// shares layout, ducking-envelope, and layer-placement algorithms with the curated
// showcase generator.
// No I/O — deterministic and testable. Gains come from the loudness formula (loudness.ts).

import { duckGain, median } from "@/lib/loudness";
import type { Asset, Clip, ProjectSnapshot, Track } from "@/lib/types";
import type { CinematicLayer, CinematicSpec } from "@/lib/cinematic-spec";

// dB each bed sits below the voice.
const DUCK = { scoreBed: 16, scoreSwell: 6, scoreClimax: 3, ambience: 20, foley: 12, impact: 2 } as const;
const SEAM = 0.02;
const r2 = (n: number) => Math.round(n * 100) / 100;

// A generated voice segment / reveal, cropped to spoken content. gap/climax ride on the
// part (not spec.voice) so an extension can be inserted as its own part.
export interface VoicePart {
  url: string;
  full: number; // asset length
  level: number; // loudness
  offset: number; // crop start into the asset
  dur: number; // cropped duration
  gap?: number; // lead-in space before this part
  climax?: boolean; // the loud dramatic beat
}
// A generated bed (score / ambience / SFX).
export interface BedPart {
  url: string;
  full: number;
  level: number;
  start: number; // audible-window start (offset into the asset)
  dur: number; // audible duration (for one-shot placement)
}
export interface AssembleParts {
  voice: VoicePart[]; // the voice/dialogue segments, in order (+ any extensions)
  reveal?: VoicePart; // optional closing line
  score?: BedPart; // optional music bed
  layers: BedPart[]; // one per spec.layers, in order
}

interface Window {
  start: number;
  dur: number;
  climax?: boolean;
}

// Ducking envelope: split the score asset into contiguous, slightly-overlapped clips so
// the level automates smoothly (same asset, offset-aligned → equal-gain crossfade).
function scoreDuck(id: string, trackId: string, assetId: string, full: number, sections: Array<{ end: number; gain: number }>): Clip[] {
  const OV = 0.25;
  const clips: Clip[] = [];
  let prevEnd = 0;
  sections.forEach((sec, i) => {
    const start = i === 0 ? 0 : r2(Math.max(0, prevEnd - OV));
    const end = r2(Math.min(sec.end, full));
    if (end > start) {
      clips.push({
        id: `${id}_c_score${i}`,
        trackId,
        assetId,
        start,
        duration: r2(end - start),
        offset: start,
        gain: sec.gain,
        fadeIn: i === 0 ? 0.6 : OV,
        fadeOut: i === sections.length - 1 ? 2.5 : OV
      });
    }
    prevEnd = Math.min(sec.end, full);
  });
  return clips;
}

// Score sits at `bed` under every voice window, `swell` in the gaps, `climax` under a
// climax-flagged beat.
function autoDuck(windows: Window[], total: number, bed: number, swell: number, climax: number): Array<{ end: number; gain: number }> {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const sections: Array<{ end: number; gain: number }> = [];
  let cursor = 0;
  for (const w of sorted) {
    const s = w.start;
    const e = Math.min(total, w.start + w.dur);
    if (s > cursor + 0.08) sections.push({ end: r2(s), gain: swell });
    sections.push({ end: r2(e), gain: w.climax ? climax : bed });
    cursor = e;
  }
  if (cursor < total - 0.08) sections.push({ end: r2(total), gain: r2(swell * 0.75) });
  return sections;
}

const track = (id: string, order: number, kind: Track["kind"], name: string): Track => ({
  id: `${id}_t${order}`,
  projectId: id,
  kind,
  name,
  gain: 1,
  muted: false,
  solo: false,
  order
});
const asset = (id: string, key: string, name: string, url: string, trackKind: Track["kind"], full: number, stamp: string): Asset => ({
  id: `${id}_${key}`,
  projectId: id,
  kind: "audio",
  trackKind,
  name,
  url,
  duration: r2(full),
  source: "generated",
  createdAt: stamp
});

export function assembleCinematic(spec: CinematicSpec, projectId: string, parts: AssembleParts, stamp: string): ProjectSnapshot {
  const id = projectId;
  const voiceTrackName = spec.voiceTrackName ?? "Scene";

  // Layout: voice segments sequentially with per-segment lead-in gaps, then the reveal.
  let t = 0.6;
  const placed: Array<{ start: number; dur: number; offset: number }> = [];
  const windows: Window[] = [];
  parts.voice.forEach((part) => {
    t = r2(t + (part.gap ?? 0.5));
    placed.push({ start: t, dur: part.dur, offset: part.offset });
    windows.push({ start: t, dur: part.dur, climax: part.climax });
    t = r2(t + part.dur);
  });
  // The closing line is optional.
  let outroStart: number | null = null;
  let total: number;
  if (parts.reveal) {
    outroStart = r2(t + (spec.outro?.gap ?? 0.7));
    windows.push({ start: outroStart, dur: parts.reveal.dur });
    total = r2(outroStart + parts.reveal.dur + 0.5);
  } else {
    total = r2(t + 0.5);
  }
  const climaxStart = windows.find((w) => w.climax)?.start ?? null;

  // Reference voice level = median of the on-timeline voice (+ closing line if present).
  const V = median([...parts.voice.map((p) => p.level), ...(parts.reveal ? [parts.reveal.level] : [])]);

  const tracks: Track[] = [track(id, 0, "voice", voiceTrackName)];
  const assets: Asset[] = parts.voice.map((p, i) => asset(id, `v${i}`, `${voiceTrackName} ${i + 1}`, p.url, "voice", p.full, stamp));
  const clips: Clip[] = placed.map((p, i) => ({
    id: `${id}_c_v${i}`,
    trackId: tracks[0].id,
    assetId: `${id}_v${i}`,
    start: p.start,
    duration: p.dur,
    offset: p.offset,
    gain: 1,
    fadeIn: 0.15,
    fadeOut: 0.3
  }));

  // Music bed (optional): ducked envelope under the voice.
  if (parts.score) {
    const scoreTrack = track(id, tracks.length, "music", "Score");
    tracks.push(scoreTrack);
    assets.push(asset(id, "score", "Score", parts.score.url, "music", parts.score.full, stamp));
    clips.push(
      ...scoreDuck(
        id,
        scoreTrack.id,
        `${id}_score`,
        parts.score.full,
        autoDuck(
          windows,
          total,
          duckGain(V, parts.score.level, DUCK.scoreBed),
          duckGain(V, parts.score.level, DUCK.scoreSwell),
          duckGain(V, parts.score.level, DUCK.scoreClimax)
        )
      )
    );
  }

  // Closing line (optional).
  if (parts.reveal && outroStart != null) {
    const revealTrack = track(id, tracks.length, "voice", "Closing");
    tracks.push(revealTrack);
    assets.push(asset(id, "reveal", "Closing line", parts.reveal.url, "voice", parts.reveal.full, stamp));
    clips.push({
      id: `${id}_c_reveal`,
      trackId: revealTrack.id,
      assetId: `${id}_reveal`,
      start: outroStart,
      duration: parts.reveal.dur,
      offset: parts.reveal.offset,
      gain: 1,
      fadeIn: 0.1,
      fadeOut: 0.3
    });
  }

  // Layers: ambience beds span the whole piece; one-shots land at their placement.
  spec.layers.forEach((layer: CinematicLayer, i) => {
    const part = parts.layers[i];
    const gain = duckGain(V, part.level, DUCK[layer.duck]);
    const order = tracks.length;
    tracks.push(track(id, order, "sfx", layer.name));
    assets.push(asset(id, `l${i}`, layer.name, part.url, "sfx", part.full, stamp));
    if (layer.place === "bed") {
      clips.push({
        id: `${id}_c_l${i}`,
        trackId: tracks[order].id,
        assetId: `${id}_l${i}`,
        start: 0,
        duration: total,
        offset: part.start,
        gain,
        fadeIn: layer.duck === "ambience" ? 1.2 : 0.8,
        fadeOut: 1.5
      });
    } else {
      const at =
        layer.place === "climax"
          ? r2((climaxStart ?? placed[0]?.start ?? 1) + 2.5)
          : layer.place === "start"
            ? r2((placed[0]?.start ?? 1) + 0.2)
            : r2(Math.max(0, layer.place));
      clips.push({
        id: `${id}_c_l${i}`,
        trackId: tracks[order].id,
        assetId: `${id}_l${i}`,
        start: at,
        duration: part.dur,
        offset: part.start,
        gain,
        fadeIn: 0.02,
        fadeOut: 0.3
      });
    }
  });

  return {
    project: { id, name: spec.name, sampleRate: 48000, createdAt: stamp, updatedAt: stamp },
    tracks,
    clips,
    assets,
    voices: [],
    jobs: [],
    promptDrafts: [],
    modelRuns: []
  };
}
