import { fal } from "@fal-ai/client";
import { getModel, seedAudioEndpoint } from "@/lib/model-catalog";
import { coerceSchemaInput } from "@/lib/model-schemas";
import { lintPrompt } from "@/lib/prompt-intelligence";
import { normalizeModelOutput } from "@/lib/result";
import type { Job, ModelOutput } from "@/lib/types";

// Cached on globalThis: Next.js dev compiles each API route separately, so a plain
// module-level Map would give POST /api/jobs and GET /api/jobs/[id] different stores.
const globalStore = globalThis as typeof globalThis & { __audioStudioJobs?: Map<string, Job> };
const jobs = globalStore.__audioStudioJobs ?? (globalStore.__audioStudioJobs = new Map<string, Job>());
const seedReferenceMaxSeconds = 30;
const seedBaseInputKeys = new Set([
  "prompt",
  "image_url",
  "audio_urls",
  "voice",
  "volume",
  "pitch",
  "speed",
  "sample_rate",
  "output_format"
]);

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function isInputRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasUsableUrl(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && item.trim().length > 0);
  return false;
}

function coerceJobInput(modelId: string, raw: Record<string, unknown>): Record<string, unknown> {
  const coerced = coerceSchemaInput(modelId, raw);
  if (coerced.errors.length) throw new Error(coerced.errors[0]);
  return coerced.input;
}

export function createJob(input: {
  modelId: string;
  operation: string;
  input: Record<string, unknown>;
  sourceAssetIds?: string[];
}): Job {
  const stamp = now();
  const jobInput = coerceJobInput(input.modelId, input.input);
  const job: Job = {
    id: id("job"),
    modelId: input.modelId,
    operation: input.operation,
    input: jobInput,
    sourceAssetIds: input.sourceAssetIds ?? [],
    status: "queued",
    progress: 0,
    logs: ["[queued] job accepted"],
    outputs: [],
    createdAt: stamp,
    updatedAt: stamp
  };
  jobs.set(job.id, job);
  return job;
}

export function readJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function validateJobRequest(input: {
  modelId?: string;
  operation?: string;
  input?: Record<string, unknown>;
  sourceAssetIds?: string[];
}): string | undefined {
  if (!input.modelId || !input.operation) return "modelId and operation are required";
  const model = getModel(input.modelId);
  if (!model) return `Unknown model: ${input.modelId}`;
  if (input.operation !== model.task) {
    return `Operation ${input.operation} does not match model task ${model.task}`;
  }
  if (input.input !== undefined && !isInputRecord(input.input)) return "input must be an object";

  const coerced = coerceSchemaInput(model.id, input.input ?? {});
  if (coerced.errors.length) return coerced.errors[0];
  const payload = coerced.input;

  if (model.needsSource && !(hasUsableUrl(payload.source_audio_url) || hasUsableUrl(payload.audio_url) || hasUsableUrl(payload.audio_urls))) {
    return "A source audio URL is required";
  }
  if (model.needsVoice && !(hasUsableUrl(payload.target_voice_url) || hasUsableUrl(payload.audio_urls) || payload.voices)) {
    return "A target voice URL is required";
  }
  if (model.needsRegion && (payload.gap_start_s === undefined || payload.gap_end_s === undefined)) {
    return "A selected region is required";
  }

  if (model.endpoint === seedAudioEndpoint) {
    const sourceDuration = Number(payload.source_duration_s);
    if (Number.isFinite(sourceDuration) && sourceDuration > seedReferenceMaxSeconds) {
      return `Seed Audio source references must be ${seedReferenceMaxSeconds}s or shorter`;
    }
    const targetDuration = Number(payload.target_voice_duration_s);
    if (Number.isFinite(targetDuration) && targetDuration > seedReferenceMaxSeconds) {
      return `Seed Audio voice references must be ${seedReferenceMaxSeconds}s or shorter`;
    }
  }

  const prompt = String(payload.prompt ?? payload.text ?? "");
  if (prompt) {
    const lint = lintPrompt(model.id, prompt);
    if (lint.blocked) return lint.warnings[0] ?? "Prompt failed validation";
  }

  return undefined;
}

function updateJob(id: string, patch: Partial<Job>): Job {
  const current = jobs.get(id);
  if (!current) throw new Error(`Unknown job ${id}`);
  const next = { ...current, ...patch, updatedAt: now() };
  jobs.set(id, next);
  return next;
}

async function uploadDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to read local audio data");
  const blob = await response.blob();
  return fal.storage.upload(blob);
}

async function prepareFalInput(value: unknown): Promise<unknown> {
  if (typeof value === "string") {
    return value.startsWith("data:") ? uploadDataUrl(value) : value;
  }
  if (Array.isArray(value)) return Promise.all(value.map((item) => prepareFalInput(item)));
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([key, item]) => [key, await prepareFalInput(item)] as const)
    );
    return Object.fromEntries(entries);
  }
  return value;
}

function compactText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// fal ApiErrors often carry an empty .message with the real cause in body.detail — surface it.
export function describeJobError(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { message?: unknown; status?: unknown; body?: { detail?: unknown } };
    const detail = err.body?.detail;
    const detailText = Array.isArray(detail)
      ? detail
          .map((item) => {
            if (item && typeof item === "object") {
              const rec = item as { msg?: unknown; loc?: unknown };
              const loc = Array.isArray(rec.loc) ? rec.loc.join(".") : "";
              return [loc, rec.msg].filter(Boolean).join(": ");
            }
            return String(item);
          })
          .join("; ")
      : typeof detail === "string"
        ? detail
        : "";
    const message = typeof err.message === "string" ? err.message.trim() : "";
    const status = typeof err.status === "number" ? `HTTP ${err.status}` : "";
    const parts = [message, detailText, !message && !detailText ? "" : status].filter(Boolean);
    if (parts.length) return parts.join(" — ");
    if (status) return status;
  }
  return String(error);
}

function sanitizeDirective(value: unknown): string {
  return compactText(value).replace(/\b(ignore|say|repeat after me)\b/gi, "").trim();
}

function audioUrlFrom(input: Record<string, unknown>): string {
  const source = input.source_audio_url ?? input.audio_url;
  if (typeof source !== "string" || !source.trim()) throw new Error("A source audio URL is required");
  return source;
}

async function transcribeSource(audioUrl: string, language?: string): Promise<string> {
  const asr = getModel("whisper-asr");
  if (!asr) throw new Error("Whisper ASR model is not configured");
  const result = await fal.subscribe(asr.endpoint, {
    input: {
      audio_url: audioUrl,
      task: "transcribe",
      diarize: true,
      chunk_level: "segment",
      ...(language ? { language } : {})
    }
  });
  const transcript = normalizeModelOutput(result.data)[0]?.transcript;
  if (!transcript?.trim()) throw new Error("ASR did not return a transcript");
  return compactText(transcript);
}

function pickSeedBaseInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => seedBaseInputKeys.has(key) && value !== "" && value !== undefined && value !== null)
  );
}

async function buildSeedPipelineInput(modelId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sample_rate = Number(input.sample_rate ?? 48000);
  const output_format = String(input.output_format ?? "wav");
  const source = typeof input.source_audio_url === "string" ? input.source_audio_url : typeof input.audio_url === "string" ? input.audio_url : "";

  if (modelId === "seed-scene" || modelId === "seed-cast-scene" || modelId === "seed-tts" || modelId === "seed-image-voice") {
    return pickSeedBaseInput(input);
  }

  if (modelId === "seed-restyle") {
    const transcript = await transcribeSource(audioUrlFrom(input));
    const style = sanitizeDirective(input.style);
    return {
      prompt: `@Audio1 Say the following, but ${style}: "${transcript}"`,
      audio_urls: [source],
      sample_rate,
      output_format
    };
  }

  if (modelId === "seed-voice-changer") {
    const target = input.target_voice_url;
    if (typeof target !== "string" || !target.trim()) throw new Error("A target voice URL is required");
    const language = input.language === "zh" ? "zh" : input.language === "en" ? "en" : undefined;
    const transcript = await transcribeSource(audioUrlFrom(input), language);
    const pacing = input.preserve_pacing === true ? " Keep the original rhythm, pauses, and timing." : "";
    return {
      prompt: `@Audio1 ${transcript}${pacing}`,
      audio_urls: [target],
      sample_rate,
      output_format
    };
  }

  if (modelId === "seed-dub") {
    const sourceSeconds = Number(input.source_duration_s);
    const fit =
      input.fit_to_length !== false && Number.isFinite(sourceSeconds) && sourceSeconds > 0
        ? ` Match the original timing of about ${sourceSeconds.toFixed(1)} seconds.`
        : "";
    return {
      prompt: `Speak the meaning of @Audio1 in ${sanitizeDirective(input.target_language)}, keeping the same voice and tone.${fit}`,
      audio_urls: [audioUrlFrom(input)],
      sample_rate,
      output_format
    };
  }

  if (modelId === "seed-extend") {
    const seconds = Number(input.add_seconds ?? 15);
    const direction = sanitizeDirective(input.direction);
    return {
      prompt: `@Audio1 Continue the same voice and topic for about ${Number.isFinite(seconds) ? seconds : 15} more seconds.${direction ? ` Direction: ${direction}.` : ""}`,
      audio_urls: [audioUrlFrom(input)],
      sample_rate,
      output_format
    };
  }

  if (modelId === "seed-inpaint") {
    const start = Number(input.gap_start_s);
    const end = Number(input.gap_end_s);
    // Verbatim: speak exact words in the source voice (bypass sanitize so the words survive).
    // Descriptive (default): the DESCRIPTIVE framing Seed needs so it fills rather than reading the prompt aloud.
    const exact = compactText(input.fill_instruction);
    const prompt =
      input.verbatim === true && exact
        ? `@Audio1 Reproduce the full recording, but from ${start.toFixed(2)}s to ${end.toFixed(2)}s the speaker says exactly: "${exact}" — in the same voice, so it flows continuously.`
        : `[Audio repair] @Audio1 has a missing section from ${start.toFixed(2)}s to ${end.toFixed(2)}s. The missing section is ${
            sanitizeDirective(input.fill_instruction) || "a natural matching continuation"
          }, preserving the surrounding voice, timing, ambience, and mix.`;
    return {
      prompt,
      audio_urls: [audioUrlFrom(input)],
      sample_rate,
      output_format
    };
  }

  return pickSeedBaseInput(input);
}

export async function buildProviderInput(modelId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const uploaded = (await prepareFalInput(input)) as Record<string, unknown>;
  const model = getModel(modelId);
  if (model?.endpoint === seedAudioEndpoint) return buildSeedPipelineInput(modelId, uploaded);
  return uploaded;
}

function hasAudioOutput(outputs: ModelOutput[]): boolean {
  return outputs.some((output) => typeof output.url === "string" && output.url.length > 0);
}

export async function runJob(jobId: string): Promise<Job> {
  const job = readJob(jobId);
  if (!job) throw new Error(`Unknown job ${jobId}`);
  const model = getModel(job.modelId);
  if (!model) throw new Error(`Unknown model: ${job.modelId}`);

  if (!process.env.FAL_KEY) {
    return updateJob(job.id, {
      status: "error",
      progress: 100,
      error: "FAL_KEY is required for live model jobs",
      logs: [...job.logs, "[error] missing FAL_KEY"]
    });
  }

  updateJob(job.id, {
    status: "running",
    progress: 25,
    logs: [...job.logs, `[running] ${model.provider} / ${model.label}`]
  });

  try {
    const providerInput = await buildProviderInput(model.id, job.input);
    const result = await fal.subscribe(model.endpoint, {
      input: providerInput,
      logs: true,
      onQueueUpdate(update) {
        if (update.status === "IN_PROGRESS") {
          const messages = update.logs.map((log) => log.message);
          const current = readJob(job.id);
          if (current) {
            updateJob(job.id, {
              progress: Math.max(current.progress, 50),
              logs: [...current.logs, ...messages.map((message) => `[fal] ${message}`)]
            });
          }
        }
      }
    });
    const outputs = normalizeModelOutput(result.data);
    if (model.task !== "asr" && !hasAudioOutput(outputs)) {
      return updateJob(job.id, {
        status: "error",
        progress: 100,
        error: "No audio output returned",
        logs: [...readJob(job.id)!.logs, "[error] no audio output returned"]
      });
    }
    return updateJob(job.id, {
      status: "done",
      progress: 100,
      outputs,
      logs: [...readJob(job.id)!.logs, `[done] ${outputs.length} output(s)`]
    });
  } catch (error) {
    const described = describeJobError(error);
    return updateJob(job.id, {
      status: "error",
      progress: 100,
      error: described,
      logs: [...readJob(job.id)!.logs, `[error] ${described}`]
    });
  }
}
