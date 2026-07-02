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

export interface BuildModelRunInputOptions {
  model: ModelDefinition;
  values: Record<string, string | number | boolean>;
  enhanced?: string;
  source?: PreparedSource;
  selectedClip?: Clip;
  region?: Region;
  selectedVoice?: Voice;
  voiceAsset?: Asset;
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
  voiceAsset
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

  if (model.needsVoice && selectedVoice && voiceAsset) {
    input.target_voice_url = voiceAsset.url;
    input.voices = [{ name: selectedVoice.name, ref_url: voiceAsset.url }];
    input.target_voice_duration_s = voiceAsset.duration;
    if (model.id === "seed-cast-scene") input.audio_urls = [voiceAsset.url];
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
