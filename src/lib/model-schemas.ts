export type SchemaFieldType =
  | "string"
  | "textarea"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "url"
  | "array"
  | "json"
  | "hidden";

export type SchemaValue = string | number | boolean | string[] | Record<string, unknown>;

export interface ModelSchemaField {
  name: string;
  label: string;
  type: SchemaFieldType;
  required?: boolean;
  defaultValue?: SchemaValue;
  options?: string[];
  helper?: string;
  advanced?: boolean;
  clientOnly?: boolean;
  hidden?: boolean;
}

export interface ModelSchema {
  modelId: string;
  endpoint: string;
  fields: ModelSchemaField[];
  outputAudioPaths: string[];
}

export interface CoercedSchemaInput {
  input: Record<string, unknown>;
  errors: string[];
}

const seedEndpoint = "bytedance/seed-audio-1.0";

const seedQualityFields: ModelSchemaField[] = [
  { name: "sample_rate", label: "Sample rate", type: "hidden", defaultValue: 48000 },
  { name: "output_format", label: "Output format", type: "hidden", defaultValue: "wav" }
];

const sourceContextFields: ModelSchemaField[] = [
  { name: "source_audio_url", label: "Source audio URL", type: "url", hidden: true },
  { name: "audio_url", label: "Audio URL", type: "url", hidden: true },
  { name: "source_duration_s", label: "Source duration", type: "number", hidden: true }
];

const voiceContextFields: ModelSchemaField[] = [
  { name: "target_voice_url", label: "Target voice URL", type: "url", hidden: true },
  { name: "target_voice_duration_s", label: "Target voice duration", type: "number", hidden: true },
  { name: "audio_urls", label: "Audio reference URLs", type: "array", hidden: true },
  { name: "voices", label: "Voice references", type: "json", hidden: true }
];

const regionContextFields: ModelSchemaField[] = [
  { name: "gap_start_s", label: "Gap start", type: "number", hidden: true },
  { name: "gap_end_s", label: "Gap end", type: "number", hidden: true }
];

const enhanceField: ModelSchemaField = {
  name: "enhance",
  label: "Enhance prompt",
  type: "boolean",
  defaultValue: true,
  clientOnly: true
};

const elevenOutputFormats = [
  "mp3_22050_32",
  "mp3_44100_32",
  "mp3_44100_64",
  "mp3_44100_96",
  "mp3_44100_128",
  "mp3_44100_192",
  "pcm_8000",
  "pcm_16000",
  "pcm_22050",
  "pcm_24000",
  "pcm_44100",
  "pcm_48000",
  "ulaw_8000",
  "alaw_8000",
  "opus_48000_32",
  "opus_48000_64",
  "opus_48000_96",
  "opus_48000_128",
  "opus_48000_192"
];

export const modelSchemas: Record<string, ModelSchema> = {
  "seed-scene": {
    modelId: "seed-scene",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", required: true, helper: "Loose idea or final Seed Audio scene prompt." },
      enhanceField,
      ...seedQualityFields
    ]
  },
  "seed-cast-scene": {
    modelId: "seed-cast-scene",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", required: true },
      enhanceField,
      ...voiceContextFields,
      ...seedQualityFields
    ]
  },
  "seed-image-voice": {
    modelId: "seed-image-voice",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "image_url", label: "Image URL", type: "url", required: true, helper: "JPEG, PNG, or WebP reference image URL." },
      { name: "prompt", label: "Text", type: "textarea", required: true, helper: "Exact line to speak; the image conditions the voice." },
      ...seedQualityFields
    ]
  },
  "eleven-tts": {
    modelId: "eleven-tts",
    endpoint: "fal-ai/elevenlabs/tts/eleven-v3",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "text", label: "Text", type: "textarea", required: true },
      { name: "voice", label: "Voice", type: "string", defaultValue: "Rachel" },
      { name: "stability", label: "Stability", type: "number", defaultValue: 0.5, advanced: true },
      { name: "timestamps", label: "Timestamps", type: "boolean", defaultValue: false, advanced: true },
      {
        name: "apply_text_normalization",
        label: "Text normalization",
        type: "enum",
        defaultValue: "auto",
        options: ["auto", "on", "off"],
        advanced: true
      },
      { name: "language_code", label: "Language code", type: "string", advanced: true }
    ]
  },
  "eleven-sfx": {
    modelId: "eleven-sfx",
    endpoint: "fal-ai/elevenlabs/sound-effects/v2",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "text", label: "SFX prompt", type: "textarea", required: true },
      enhanceField,
      { name: "duration_seconds", label: "Duration seconds", type: "number", advanced: true },
      { name: "loop", label: "Loop", type: "boolean", defaultValue: false, advanced: true },
      { name: "prompt_influence", label: "Prompt influence", type: "number", defaultValue: 0.3, advanced: true },
      {
        name: "output_format",
        label: "Output format",
        type: "enum",
        defaultValue: "mp3_44100_128",
        options: elevenOutputFormats,
        advanced: true
      }
    ]
  },
  "stable-audio": {
    modelId: "stable-audio",
    endpoint: "fal-ai/stable-audio-25/text-to-audio",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", required: true },
      enhanceField,
      { name: "seconds_total", label: "Duration seconds", type: "integer", defaultValue: 30 },
      { name: "guidance_scale", label: "Guidance scale", type: "number", defaultValue: 1, advanced: true },
      { name: "num_inference_steps", label: "Inference steps", type: "integer", defaultValue: 8, advanced: true },
      { name: "seed", label: "Seed", type: "integer", advanced: true },
      { name: "sync_mode", label: "Sync mode", type: "boolean", defaultValue: false, advanced: true }
    ]
  },
  "minimax-music": {
    modelId: "minimax-music",
    endpoint: "fal-ai/minimax-music/v2.6",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "prompt", label: "Style prompt", type: "textarea", required: true, helper: "Style, mood, genre, and scenario." },
      enhanceField,
      { name: "lyrics", label: "Lyrics", type: "textarea", defaultValue: "", helper: "Optional. Use line breaks and tags like [Verse], [Chorus]." },
      { name: "is_instrumental", label: "Instrumental", type: "boolean", defaultValue: false },
      { name: "lyrics_optimizer", label: "Lyrics optimizer", type: "boolean", defaultValue: false, advanced: true },
      { name: "audio_setting", label: "Audio setting JSON", type: "json", advanced: true }
    ]
  },
  mmaudio: {
    modelId: "mmaudio",
    endpoint: "fal-ai/mmaudio-v2/text-to-audio",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", required: true },
      { name: "duration", label: "Duration seconds", type: "number", defaultValue: 8 },
      { name: "negative_prompt", label: "Negative prompt", type: "textarea", defaultValue: "", advanced: true },
      { name: "cfg_strength", label: "CFG strength", type: "number", defaultValue: 4.5, advanced: true },
      { name: "num_steps", label: "Steps", type: "integer", defaultValue: 25, advanced: true },
      { name: "seed", label: "Seed", type: "integer", advanced: true },
      { name: "mask_away_clip", label: "Mask away clip", type: "boolean", defaultValue: false, advanced: true }
    ]
  },
  "seed-restyle": {
    modelId: "seed-restyle",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "style", label: "Style", type: "string", required: true, helper: "Example: slow calm whisper." },
      ...sourceContextFields,
      ...seedQualityFields
    ]
  },
  "seed-voice-changer": {
    modelId: "seed-voice-changer",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "language", label: "Language", type: "enum", defaultValue: "en", options: ["en", "zh"] },
      { name: "preserve_pacing", label: "Preserve pacing", type: "boolean", defaultValue: false },
      ...sourceContextFields,
      ...voiceContextFields,
      ...seedQualityFields
    ]
  },
  "seed-dub": {
    modelId: "seed-dub",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "target_language", label: "Target language", type: "enum", required: true, options: ["Spanish", "French", "German", "Japanese", "Chinese", "English"] },
      { name: "mode", label: "Mode", type: "enum", defaultValue: "fast", options: ["fast"] },
      ...sourceContextFields,
      ...seedQualityFields
    ]
  },
  "seed-extend": {
    modelId: "seed-extend",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "add_seconds", label: "Add seconds", type: "integer", defaultValue: 15 },
      { name: "direction", label: "Direction", type: "string" },
      ...sourceContextFields,
      ...seedQualityFields
    ]
  },
  "seed-inpaint": {
    modelId: "seed-inpaint",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "fill_instruction", label: "Fill instruction", type: "string" },
      ...sourceContextFields,
      ...regionContextFields,
      ...seedQualityFields
    ]
  },
  "stable-audio-to-audio": {
    modelId: "stable-audio-to-audio",
    endpoint: "fal-ai/stable-audio-25/audio-to-audio",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", required: true },
      ...sourceContextFields,
      { name: "total_seconds", label: "Duration seconds", type: "number", advanced: true },
      { name: "strength", label: "Strength", type: "number", defaultValue: 0.8, advanced: true },
      { name: "guidance_scale", label: "Guidance scale", type: "number", defaultValue: 1, advanced: true },
      { name: "num_inference_steps", label: "Inference steps", type: "integer", defaultValue: 8, advanced: true },
      { name: "seed", label: "Seed", type: "integer", advanced: true },
      { name: "sync_mode", label: "Sync mode", type: "boolean", defaultValue: false, advanced: true }
    ]
  },
  "whisper-asr": {
    modelId: "whisper-asr",
    endpoint: "fal-ai/whisper",
    outputAudioPaths: [],
    fields: [
      { name: "task", label: "Task", type: "hidden", defaultValue: "transcribe" },
      { name: "diarize", label: "Diarize", type: "hidden", defaultValue: true },
      { name: "chunk_level", label: "Chunk level", type: "hidden", defaultValue: "segment" },
      ...sourceContextFields,
      { name: "language", label: "Language", type: "string", advanced: true },
      { name: "num_speakers", label: "Speakers", type: "integer", advanced: true },
      { name: "batch_size", label: "Batch size", type: "integer", defaultValue: 64, advanced: true },
      { name: "prompt", label: "Prompt", type: "string", defaultValue: "", advanced: true }
    ]
  }
};

export function getModelSchema(modelId: string): ModelSchema {
  const schema = modelSchemas[modelId];
  if (!schema) throw new Error(`Missing model schema: ${modelId}`);
  return schema;
}

export function schemaDefaults(modelId: string): Record<string, string | number | boolean> {
  return Object.fromEntries(
    getModelSchema(modelId).fields
      .filter((field) => field.defaultValue !== undefined && isPrimitive(field.defaultValue))
      .map((field) => [field.name, field.defaultValue as string | number | boolean])
  );
}

export function visibleSchemaFields(modelId: string): ModelSchemaField[] {
  return getModelSchema(modelId).fields.filter((field) => field.type !== "hidden" && !field.hidden);
}

export function coerceSchemaInput(modelId: string, values: Record<string, unknown>): CoercedSchemaInput {
  const errors: string[] = [];
  const input: Record<string, unknown> = {};

  for (const field of getModelSchema(modelId).fields) {
    const raw = values[field.name] ?? field.defaultValue;
    if (field.clientOnly) continue;
    if (isEmpty(raw)) {
      if (field.required) errors.push(`${field.label} is required`);
      continue;
    }

    const value = coerceField(field, raw);
    if (value.error) {
      errors.push(value.error);
      continue;
    }
    input[field.name] = value.value;
  }

  return { input, errors };
}

function isPrimitive(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function coerceField(field: ModelSchemaField, value: unknown): { value?: unknown; error?: string } {
  if (field.type === "hidden") return { value };
  if (field.type === "boolean") {
    if (typeof value === "boolean") return { value };
    if (value === "true") return { value: true };
    if (value === "false") return { value: false };
    return { error: `${field.label} must be true or false` };
  }
  if (field.type === "number" || field.type === "integer") {
    const next = Number(value);
    if (!Number.isFinite(next)) return { error: `${field.label} must be a number` };
    if (field.type === "integer" && !Number.isInteger(next)) return { error: `${field.label} must be an integer` };
    return { value: next };
  }
  if (field.type === "array") {
    if (Array.isArray(value)) return { value };
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) return { value: parsed };
      } catch {
        return { error: `${field.label} must be valid JSON array` };
      }
    }
    return { error: `${field.label} must be an array` };
  }
  if (field.type === "json") {
    if (typeof value === "object") return { value };
    if (typeof value === "string") {
      try {
        return { value: JSON.parse(value) as unknown };
      } catch {
        return { error: `${field.label} must be valid JSON` };
      }
    }
    return { error: `${field.label} must be JSON` };
  }
  if (typeof value !== "string") return { error: `${field.label} must be text` };
  const text = value.trim();
  if (field.type === "enum" && field.options && !field.options.includes(text)) {
    return { error: `${field.label} must be one of: ${field.options.join(", ")}` };
  }
  if (field.type === "url" && !/^(https?:|data:)/.test(text)) {
    return { error: `${field.label} must be a URL` };
  }
  return { value: text };
}
