// Client orchestrator: runs an in-app Compose CinematicSpec end-to-end and returns a
// ProjectSnapshot. It shares the cinematic generation and mixing algorithm with the
// curated showcase generator.
//   anchor → clones/scene/score/beds (parallel) → crop VOs → measure levels → assemble.
// runJob/analyze are injectable so it's testable without the network.

import { analyzeClip, type ClipAnalysis } from "@/lib/audio-io";
import { assembleCinematic, type AssembleParts, type BedPart, type VoicePart } from "@/lib/cinematic-assemble";
import { resolvePromptCast, type CinematicCastRef } from "@/lib/cinematic-cast";
import { specJobCount, type CinematicSpec } from "@/lib/cinematic-spec";
import { runClientJob } from "@/lib/job-client";
import type { ModelOutput, ProjectSnapshot } from "@/lib/types";

export interface CinematicProgress {
  phase: string;
  done: number;
  total: number;
}

export interface RunCinematicOptions {
  cast?: CinematicCastRef[];
  onProgress?: (progress: CinematicProgress) => void;
  signal?: AbortSignal;
  runJob?: (modelId: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<ModelOutput>;
  analyze?: (url: string) => Promise<ClipAnalysis | null>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function requireOutputUrl(output: ModelOutput | null | undefined, phase: string): string {
  if (!output?.url) throw new Error(`${phase} produced no audio`);
  return output.url;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("aborted");
}

// Crop to spoken content via whisper word timings; fall back to the audible window.
async function speechCrop(
  runJob: NonNullable<RunCinematicOptions["runJob"]>,
  signal: AbortSignal | undefined,
  url: string,
  analysis: ClipAnalysis | null,
  tail: number
): Promise<{ offset: number; dur: number }> {
  try {
    const out = await runJob("whisper-asr", { audio_url: url }, signal);
    throwIfAborted(signal);
    const segs = out.transcriptSegments ?? [];
    if (segs.length) {
      const full = analysis?.duration ?? segs[segs.length - 1].end + tail;
      const offset = r2(Math.max(0, segs[0].start - 0.15));
      const dur = r2(Math.min(full - offset, segs[segs.length - 1].end - offset + tail));
      return { offset, dur: Math.max(0.25, dur) };
    }
  } catch {
    throwIfAborted(signal);
    /* fall through to the audible window */
  }
  if (analysis) return { offset: r2(analysis.start), dur: r2(Math.max(0.25, analysis.end - analysis.start)) };
  return { offset: 0, dur: 4 };
}

export async function runCinematic(spec: CinematicSpec, projectId: string, opts: RunCinematicOptions = {}): Promise<ProjectSnapshot> {
  const runJob = opts.runJob ?? runClientJob;
  const analyze = opts.analyze ?? analyzeClip;
  const { signal } = opts;
  const cast = opts.cast ?? [];
  const castMode = cast.length > 0;
  const total = specJobCount(spec) - (castMode && spec.anchor ? 1 : 0);
  let done = 0;
  const bump = (phase: string) => {
    done += 1;
    opts.onProgress?.({ phase, done, total });
  };
  // Wave 1 — the voice anchor (clone reference), only when the piece wants a consistent voice.
  let anchorUrl: string | null = null;
  if (spec.anchor && !castMode) {
    opts.onProgress?.({ phase: "Recording the voice anchor", done, total });
    const anchor = await runJob("seed-tts", { prompt: spec.anchor.prompt, enhance: false }, signal);
    anchorUrl = anchor.url ?? null;
    if (!anchorUrl) throw new Error("The voice anchor produced no audio");
    bump("Voice anchor ready");
  }
  opts.onProgress?.({ phase: "Generating audio", done, total });

  // Wave 2 — everything the brief calls for, in parallel (reveal/score are optional).
  const withAnchor = (input: Record<string, unknown>, on: boolean) => (on && anchorUrl ? { ...input, audio_urls: [anchorUrl] } : input);
  const withVoiceRefs = (prompt: string, useAnchor: boolean): Record<string, unknown> => {
    if (castMode) {
      const resolved = resolvePromptCast(prompt, cast);
      return {
        prompt: resolved.prompt,
        enhance: false,
        ...(resolved.audioUrls.length ? { audio_urls: resolved.audioUrls } : {})
      };
    }
    return withAnchor({ prompt, enhance: false }, useAnchor);
  };
  const step = (phase: string, modelId: string, input: Record<string, unknown>) =>
    runJob(modelId, input, signal).then((out) => {
      bump(phase);
      return out;
    });

  const [voiceOuts, revealOut, scoreOut, layerOuts] = await Promise.all([
    Promise.all(
      spec.voice.map((seg) => step("Generated a voice line", seg.model, withVoiceRefs(seg.prompt, Boolean(seg.clone || seg.useAnchor))))
    ),
    spec.outro ? step("Generated the closing line", "seed-tts", withVoiceRefs(spec.outro.prompt, true)) : Promise.resolve(null),
    spec.score ? step("Generated the score", "stable-audio", { prompt: spec.score.prompt, seconds_total: spec.score.seconds }) : Promise.resolve(null),
    Promise.all(
      spec.layers.map((layer) =>
        step(
          "Generated a bed",
          layer.model,
          layer.model === "mmaudio" ? { prompt: layer.prompt, duration: layer.seconds } : { text: layer.text, duration_seconds: layer.seconds }
        )
      )
    )
  ]);
  throwIfAborted(signal);
  const voiceUrls = voiceOuts.map((output) => requireOutputUrl(output, "Voice line"));
  const revealUrl = spec.outro ? requireOutputUrl(revealOut, "Closing line") : null;
  const scoreUrl = spec.score ? requireOutputUrl(scoreOut, "Score") : null;
  const layerUrls = layerOuts.map((output) => requireOutputUrl(output, "Audio layer"));

  // Crop + measure the voice segments and reveal. A segment flagged `extend` also runs
  // seed-extend and appends the continuation as its own part (butt-joined after it).
  const voice: VoicePart[] = [];
  for (let i = 0; i < spec.voice.length; i++) {
    const seg = spec.voice[i];
    const url = voiceUrls[i];
    const analysis = await analyze(url);
    const crop = await speechCrop(runJob, signal, url, analysis, seg.tail ?? 0.3);
    bump("Cropped a voice line");
    voice.push({ url, full: analysis?.duration ?? crop.dur, level: analysis?.level ?? 0.03, offset: crop.offset, dur: crop.dur, gap: seg.gap, climax: seg.climax });
    if (seg.extend) {
      const ext = await runJob(
        "seed-extend",
        { source_audio_url: url, add_seconds: seg.extend.seconds, ...(seg.extend.direction ? { direction: seg.extend.direction } : {}) },
        signal
      );
      bump("Extended a voice line");
      const extUrl = requireOutputUrl(ext, "Voice extension");
      const extAnalysis = await analyze(extUrl);
      const extCrop = await speechCrop(runJob, signal, extUrl, extAnalysis, 0.3);
      bump("Cropped the extension");
      voice.push({ url: extUrl, full: extAnalysis?.duration ?? extCrop.dur, level: extAnalysis?.level ?? 0.03, offset: extCrop.offset, dur: extCrop.dur, gap: 0.05, climax: false });
    }
  }
  // Closing line (optional): crop + measure.
  let reveal: VoicePart | undefined;
  if (spec.outro && revealUrl) {
    const revealAnalysis = await analyze(revealUrl);
    const revealCrop = await speechCrop(runJob, signal, revealUrl, revealAnalysis, 0.4);
    bump("Cropped the closing line");
    reveal = {
      url: revealUrl,
      full: revealAnalysis?.duration ?? revealCrop.dur,
      level: revealAnalysis?.level ?? 0.03,
      offset: revealCrop.offset,
      dur: revealCrop.dur
    };
  }

  // Music bed (optional): measure.
  let score: BedPart | undefined;
  if (spec.score && scoreUrl) {
    const scoreAnalysis = await analyze(scoreUrl);
    score = {
      url: scoreUrl,
      full: scoreAnalysis?.duration ?? spec.score.seconds,
      level: scoreAnalysis?.level ?? 0.1,
      start: scoreAnalysis?.start ?? 0,
      dur: scoreAnalysis ? Math.max(0.25, scoreAnalysis.end - scoreAnalysis.start) : spec.score.seconds
    };
  }
  const layers: BedPart[] = [];
  for (let i = 0; i < spec.layers.length; i++) {
    const analysis = await analyze(layerUrls[i]);
    layers.push({
      url: layerUrls[i],
      full: analysis?.duration ?? spec.layers[i].seconds ?? 8,
      level: analysis?.level ?? 0.1,
      start: analysis?.start ?? 0,
      dur: analysis ? Math.max(0.25, analysis.end - analysis.start) : spec.layers[i].seconds ?? 8
    });
  }

  throwIfAborted(signal);
  opts.onProgress?.({ phase: "Assembling the mix", done, total });
  const parts: AssembleParts = { voice, reveal, score, layers };
  return assembleCinematic(spec, projectId, parts, new Date().toISOString());
}
