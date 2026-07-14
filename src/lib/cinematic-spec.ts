// JSON-serializable spec for a full cinematic piece, authored by the in-app Compose
// planner and executed by cinematic-runner. It is data-only: SFX placement is a
// keyword/number, not a callback.

import { replaceMentionsWithAudioTags, stripUnknownMentionMarkers } from "./mentions";
import { normalizeCinematicCharacterNames } from "./cinematic-cast";

export type CinematicVoiceModel = "seed-tts" | "seed-scene";
export type CinematicLayerModel = "mmaudio" | "eleven-sfx";
export type DuckRole = "ambience" | "foley" | "impact";
export type LayerPlace = "bed" | "climax" | "start" | number;

export interface CinematicVoiceSeg {
  model: CinematicVoiceModel;
  prompt: string;
  clone?: boolean; // a VO line cloned from the anchor (@Audio1)
  useAnchor?: boolean; // a scene where a character reuses the anchor voice (@Audio1)
  climax?: boolean; // the loud dramatic beat — score rides big under it
  tail?: number; // non-speech payoff kept after the last word (roar/impact)
  gap?: number; // lead-in space before this segment
  // Optional: continue this segment for `seconds` more in the same voice (seed-extend),
  // butt-joined right after it — for a longer, unbroken narration/beat.
  extend?: { seconds: number; direction?: string };
}

export interface CinematicLayer {
  model: CinematicLayerModel;
  name: string;
  duck: DuckRole;
  place: LayerPlace; // "bed" = full length; "climax"/"start"/seconds = one-shot
  prompt?: string; // mmaudio
  text?: string; // eleven-sfx
  seconds?: number;
}

export interface CinematicSpec {
  name: string;
  voiceTrackName?: string;
  // All optional except voice — the LLM includes only what the brief needs. A podcast has
  // no score/reveal; a jingle-backed ad has no reveal; a trailer has all of it.
  anchor?: { prompt: string }; // a cloned voice, only when a consistent voice is wanted
  voice: CinematicVoiceSeg[];
  score?: { prompt: string; seconds: number };
  layers: CinematicLayer[];
  outro?: { prompt: string; gap?: number }; // a closing line/tagline — NOT a forced meta-reveal
}

export interface CinematicSpecContext {
  characterNames?: string[];
}

// Bounds — cap cost (job count) and keep durations sane. Also the contract the LLM
// is told to stay within.
export const SPEC_LIMITS = {
  maxVoiceSegs: 5,
  maxLayers: 4,
  scoreSecondsMin: 8,
  scoreSecondsMax: 60,
  layerSecondsMin: 2,
  layerSecondsMax: 15,
  tailMax: 2,
  gapMax: 4,
  extendMin: 4,
  extendMax: 15
} as const;

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const value = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, value));
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

class SpecError extends Error {}

// Without an anchor there's nothing to clone, so remove dangling @Audio tags — otherwise
// the model reads "voiced by @Audio1" aloud.
const stripAnchorTags = (prompt: string): string =>
  prompt
    .replace(/\s*\(\s*voiced by @Audio\d+\s*\)/gi, "")
    .replace(/\s*,?\s*voiced by @Audio\d+/gi, "")
    .replace(/\s*@Audio\d+/gi, "")
    .trim();

const sanitizeCastPrompt = (prompt: string, characterNames: string[]): string => {
  const targets = characterNames.map((name, index) => ({ id: String(index), name }));
  const tagged = replaceMentionsWithAudioTags(stripAnchorTags(prompt), targets);
  const withoutUnknownMarkers = stripUnknownMentionMarkers(tagged);
  return withoutUnknownMarkers.replace(/@Audio(\d+)\b/g, (tag, rawIndex: string) => {
    const name = characterNames[Number(rawIndex) - 1];
    return name ? `@${name}` : tag;
  });
};

function coerceVoiceSeg(raw: unknown, index: number): CinematicVoiceSeg {
  if (!raw || typeof raw !== "object") throw new SpecError(`voice[${index}] is not an object`);
  const seg = raw as Record<string, unknown>;
  const model = seg.model === "seed-scene" ? "seed-scene" : "seed-tts";
  const prompt = str(seg.prompt);
  if (!prompt) throw new SpecError(`voice[${index}].prompt is empty`);
  const extendRaw = seg.extend as Record<string, unknown> | undefined;
  const extend =
    extendRaw && Number(extendRaw.seconds) > 0
      ? { seconds: clamp(extendRaw.seconds, SPEC_LIMITS.extendMin, SPEC_LIMITS.extendMax, 8), direction: str(extendRaw.direction) || undefined }
      : undefined;
  return {
    model,
    prompt,
    clone: seg.clone === true,
    useAnchor: seg.useAnchor === true,
    climax: seg.climax === true,
    tail: clamp(seg.tail, 0, SPEC_LIMITS.tailMax, 0.3),
    gap: clamp(seg.gap, 0, SPEC_LIMITS.gapMax, 0.5),
    ...(extend ? { extend } : {})
  };
}

function coerceLayer(raw: unknown, index: number): CinematicLayer {
  if (!raw || typeof raw !== "object") throw new SpecError(`layers[${index}] is not an object`);
  const layer = raw as Record<string, unknown>;
  const model = layer.model === "mmaudio" ? "mmaudio" : "eleven-sfx";
  const duck: DuckRole = layer.duck === "ambience" || layer.duck === "impact" ? layer.duck : "foley";
  const rawPlace = layer.place;
  const place: LayerPlace =
    typeof rawPlace === "number" && Number.isFinite(rawPlace)
      ? Math.max(0, rawPlace)
      : rawPlace === "climax" || rawPlace === "start"
        ? rawPlace
        : "bed";
  const prompt = str(layer.prompt);
  const text = str(layer.text);
  if (model === "mmaudio" && !prompt) throw new SpecError(`layers[${index}] (mmaudio) needs a prompt`);
  if (model === "eleven-sfx" && !text) throw new SpecError(`layers[${index}] (eleven-sfx) needs text`);
  return {
    model,
    name: str(layer.name) || (duck === "ambience" ? "Ambience" : "SFX"),
    duck,
    place,
    ...(prompt ? { prompt } : {}),
    ...(text ? { text } : {}),
    seconds: clamp(layer.seconds, SPEC_LIMITS.layerSecondsMin, SPEC_LIMITS.layerSecondsMax, 8)
  };
}

// Validates + clamps a raw (LLM-authored) object into a safe CinematicSpec. Throws a
// SpecError with a readable reason if the shape is unusable.
export function validateCinematicSpec(raw: unknown, context: CinematicSpecContext = {}): CinematicSpec {
  if (!raw || typeof raw !== "object") throw new SpecError("spec is not an object");
  const spec = raw as Record<string, unknown>;
  const characterNames = normalizeCinematicCharacterNames(context.characterNames);
  const castMode = characterNames.length > 0;

  const voiceRaw = Array.isArray(spec.voice) ? spec.voice : [];
  if (!voiceRaw.length) throw new SpecError("voice[] must have at least one segment");
  let voice = voiceRaw.slice(0, SPEC_LIMITS.maxVoiceSegs).map(coerceVoiceSeg);

  const anchorPrompt = str((spec.anchor as Record<string, unknown> | undefined)?.prompt);
  const anchor = !castMode && anchorPrompt ? { prompt: anchorPrompt } : undefined;

  const scoreObj = spec.score as Record<string, unknown> | undefined;
  const scorePrompt = str(scoreObj?.prompt);
  const score = scorePrompt ? { prompt: scorePrompt, seconds: clamp(scoreObj?.seconds, SPEC_LIMITS.scoreSecondsMin, SPEC_LIMITS.scoreSecondsMax, 28) } : undefined;

  const outroObj = spec.outro as Record<string, unknown> | undefined;
  const outroPrompt = str(outroObj?.prompt);
  let outro = outroPrompt ? { prompt: outroPrompt, gap: clamp(outroObj?.gap, 0, SPEC_LIMITS.gapMax, 0.7) } : undefined;

  const layersRaw = Array.isArray(spec.layers) ? spec.layers : [];
  const layers = layersRaw.slice(0, SPEC_LIMITS.maxLayers).map(coerceLayer);

  if (castMode) {
    voice = voice.map((seg) => ({
      ...seg,
      clone: false,
      useAnchor: false,
      prompt: sanitizeCastPrompt(seg.prompt, characterNames)
    }));
    if (outro) outro = { ...outro, prompt: sanitizeCastPrompt(outro.prompt, characterNames) };
  } else if (!anchor) {
    // No anchor → no cloning: drop clone/useAnchor flags and strip dangling @Audio tags.
    voice = voice.map((seg) => ({ ...seg, clone: false, useAnchor: false, prompt: stripAnchorTags(seg.prompt) }));
    if (outro) outro = { ...outro, prompt: stripAnchorTags(outro.prompt) };
  }

  return {
    name: str(spec.name) || "Audio piece",
    voiceTrackName: str(spec.voiceTrackName) || "Voice",
    ...(anchor ? { anchor } : {}),
    voice,
    ...(score ? { score } : {}),
    layers,
    ...(outro ? { outro } : {})
  };
}

// Total live jobs a spec will run (for the cost/progress display). Counts only the parts
// that are present: (anchor?) + voice gens + crops + extends(gen+crop) + (score?) + layers +
// (reveal gen + crop)?.
export function specJobCount(spec: CinematicSpec): number {
  const extended = spec.voice.filter((seg) => seg.extend).length;
  let count = spec.voice.length * 2 + extended * 2 + spec.layers.length;
  if (spec.anchor) count += 1;
  if (spec.score) count += 1;
  if (spec.outro) count += 2;
  return count;
}
