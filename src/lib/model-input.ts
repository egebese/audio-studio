import { replaceMentionsWithAudioTags } from "./mentions";
import type { ModelDefinition } from "./model-catalog";
import { coerceSchemaInput, getModelSchema } from "./model-schemas";
import { regionToClipSeconds, regionToSourceSeconds } from "./region";
import type { Asset, Clip, Region, Voice } from "./types";

export interface PreparedSource {
  url: string;
  clipLocal: boolean;
  sourceOffset: number;
  duration?: number;
}

export interface MentionVoiceRef {
  name: string;
  url: string;
}

export interface BuildModelRunInputOptions {
  model: ModelDefinition;
  values: Record<string, string | number | boolean>;
  enhanced?: string;
  source?: PreparedSource;
  selectedClip?: Clip;
  region?: Region;
  selectedVoice?: Voice;
  voiceAsset?: Asset;
  /* Voices @mentioned in the prompt, in mention order (mapped to @Audio1..N). */
  mentionVoices?: MentionVoiceRef[];
}

export interface BuildModelRunInputResult {
  input: Record<string, unknown>;
  errors: string[];
}

export function buildModelRunInput({
  model,
  values,
  enhanced,
  source,
  selectedClip,
  region,
  selectedVoice,
  voiceAsset,
  mentionVoices
}: BuildModelRunInputOptions): BuildModelRunInputResult {
  const nextValues: Record<string, unknown> = { ...values };
  const schema = getModelSchema(model.id);

  if (model.enhancesPrompt && values.enhance !== false && enhanced) {
    const fieldNames = new Set(schema.fields.map((field) => field.name));
    if (fieldNames.has("prompt")) nextValues.prompt = enhanced;
    if (fieldNames.has("text")) nextValues.text = enhanced;
  }

  const coerced = coerceSchemaInput(model.id, nextValues);
  const input = { ...coerced.input };

  if (model.needsSource && source) {
    input.source_audio_url = source.url;
    input.audio_url = source.url;
    input.__source_offset_s = source.sourceOffset;
    if (source.duration !== undefined) input.source_duration_s = source.duration;
  }

  // A cast is the selected voice (if any) followed by every @mentioned voice, in order.
  // Cast Scene and the mention-based seed models consume these positionally as @Audio1..N.
  const castRefs: Array<{ name: string; url: string }> = [];
  if (model.needsVoice && selectedVoice && voiceAsset) {
    input.target_voice_url = voiceAsset.url;
    input.target_voice_duration_s = voiceAsset.duration;
    castRefs.push({ name: selectedVoice.name, url: voiceAsset.url });
  }
  for (const voice of mentionVoices ?? []) {
    if (!castRefs.some((ref) => ref.url === voice.url)) castRefs.push({ name: voice.name, url: voice.url });
  }

  if (castRefs.length) {
    input.voices = castRefs.map((ref) => ({ name: ref.name, ref_url: ref.url }));
    // Voice Changer targets a single voice via target_voice_url; everyone else references positionally.
    if (model.id !== "seed-voice-changer") input.audio_urls = castRefs.map((ref) => ref.url);
    // Enhanced prompts already carry @AudioN tags from the LLM; raw prompts need the rewrite.
    for (const key of ["prompt", "text"] as const) {
      if (typeof input[key] === "string") {
        input[key] = replaceMentionsWithAudioTags(input[key] as string, castRefs.map((ref) => ({ id: ref.url, name: ref.name })));
      }
    }
  }

  if (model.needsRegion && selectedClip && region) {
    const sourceRegion = source?.clipLocal
      ? regionToClipSeconds(selectedClip, region)
      : regionToSourceSeconds(selectedClip, region);
    input.gap_start_s = sourceRegion.start;
    input.gap_end_s = sourceRegion.end;
  }

  return { input, errors: coerced.errors };
}
