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
  /* Slider rendering (number/integer): both min and max present → range control. */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  maxLength?: number;
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

/* Lets @mention voice references survive schema coercion on prompt-only seed models. */
const mentionAudioField: ModelSchemaField = {
  name: "audio_urls",
  label: "Audio reference URLs",
  type: "array",
  hidden: true
};

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

// Client-only "generate N takes" control — runModel fires the job N times and stacks the outputs.
const variationsField: ModelSchemaField = {
  name: "variations",
  label: "Takes",
  type: "integer",
  defaultValue: 1,
  min: 1,
  max: 3,
  clientOnly: true,
  advanced: true,
  helper: "Render this many alternate takes in one Run to audition, then keep the best."
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
      {
        name: "prompt",
        label: "Prompt",
        type: "textarea",
        required: true,
        maxLength: 2048,
        helper: "Describe the scene loosely — voices, music, ambience. Enhance turns it into a finished Seed Audio prompt. Mention saved voices with @."
      },
      enhanceField,
      mentionAudioField,
      ...seedQualityFields
    ]
  },
  "seed-cast-scene": {
    modelId: "seed-cast-scene",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", required: true, maxLength: 2048, helper: "Scene with your saved voice as a speaker. Mention more voices with @." },
      enhanceField,
      ...voiceContextFields,
      ...seedQualityFields
    ]
  },
  "seed-tts": {
    modelId: "seed-tts",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      {
        name: "prompt",
        label: "Text",
        type: "textarea",
        required: true,
        maxLength: 2048,
        helper: "Text to speak, or a loose request; Enhance adds the voice spec. Mention saved voices with @ to clone them."
      },
      enhanceField,
      variationsField,
      mentionAudioField,
      ...seedQualityFields
    ]
  },
  "seed-image-voice": {
    modelId: "seed-image-voice",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "image_url", label: "Reference image", type: "url", required: true, helper: "The face in the image conditions the generated voice. Drop a JPEG, PNG, or WebP here." },
      { name: "prompt", label: "Text", type: "textarea", required: true, maxLength: 2048, helper: "Exact line to speak; the image conditions the voice." },
      ...seedQualityFields
    ]
  },
  "eleven-tts": {
    modelId: "eleven-tts",
    endpoint: "fal-ai/elevenlabs/tts/eleven-v3",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "text", label: "Text", type: "textarea", required: true, helper: "The exact text to speak." },
      { name: "voice", label: "Voice", type: "string", defaultValue: "Rachel", helper: "ElevenLabs voice name, e.g. Rachel, Adam, Bella. Type @ to reuse a saved voice's name." },
      variationsField,
      {
        name: "stability",
        label: "Stability",
        type: "number",
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.05,
        advanced: true,
        helper: "Low = more expressive and varied, high = steadier and more consistent."
      },
      { name: "timestamps", label: "Timestamps", type: "boolean", defaultValue: false, advanced: true, helper: "Also return per-character timing data." },
      {
        name: "apply_text_normalization",
        label: "Text normalization",
        type: "enum",
        defaultValue: "auto",
        options: ["auto", "on", "off"],
        advanced: true,
        helper: "Expands numbers and abbreviations into spoken words."
      },
      { name: "language_code", label: "Language", type: "string", advanced: true, helper: "ISO code like en, tr, de. Leave empty to auto-detect." }
    ]
  },
  "eleven-sfx": {
    modelId: "eleven-sfx",
    endpoint: "fal-ai/elevenlabs/sound-effects/v2",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "text", label: "SFX prompt", type: "textarea", required: true, helper: "Describe the sound, e.g. glass shattering on concrete." },
      enhanceField,
      {
        name: "duration_seconds",
        label: "Duration",
        type: "number",
        min: 0.5,
        max: 22,
        step: 0.5,
        unit: "s",
        advanced: true,
        helper: "Leave empty to let the model pick a natural length."
      },
      { name: "loop", label: "Loop", type: "boolean", defaultValue: false, advanced: true, helper: "Make the sound loop seamlessly." },
      {
        name: "prompt_influence",
        label: "Prompt influence",
        type: "number",
        defaultValue: 0.3,
        min: 0,
        max: 1,
        step: 0.05,
        advanced: true,
        helper: "Higher sticks closer to your text, lower is more creative."
      },
      {
        name: "output_format",
        label: "Output format",
        type: "enum",
        defaultValue: "mp3_44100_128",
        options: elevenOutputFormats,
        advanced: true,
        helper: "Codec, sample rate and bitrate of the returned file."
      }
    ]
  },
  "stable-audio": {
    modelId: "stable-audio",
    endpoint: "fal-ai/stable-audio-25/text-to-audio",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", required: true, helper: "Genre, mood, instruments, tempo — e.g. dreamy lo-fi hip hop, 80 BPM." },
      enhanceField,
      { name: "seconds_total", label: "Duration", type: "integer", defaultValue: 30, min: 1, max: 190, unit: "s", helper: "Length of the generated audio." },
      { name: "guidance_scale", label: "Prompt strength", type: "number", defaultValue: 1, min: 1, max: 25, step: 0.5, advanced: true, helper: "Higher follows the prompt more literally." },
      { name: "num_inference_steps", label: "Quality steps", type: "integer", defaultValue: 8, min: 4, max: 25, advanced: true, helper: "More steps = higher quality, slower generation." },
      { name: "seed", label: "Seed", type: "integer", advanced: true, helper: "Same seed + same prompt reproduces the same result." },
      { name: "sync_mode", label: "Sync mode", type: "boolean", defaultValue: false, advanced: true, helper: "Return the audio in the response instead of a hosted file." }
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
      { name: "is_instrumental", label: "Instrumental", type: "boolean", defaultValue: false, helper: "Music only, no vocals." },
      variationsField,
      { name: "lyrics_optimizer", label: "Lyrics optimizer", type: "boolean", defaultValue: false, advanced: true, helper: "Let the model polish your lyrics before singing them." },
      { name: "audio_setting", label: "Audio setting JSON", type: "json", advanced: true, helper: "Raw audio settings object passed straight to the model." }
    ]
  },
  mmaudio: {
    modelId: "mmaudio",
    endpoint: "fal-ai/mmaudio-v2/text-to-audio",
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "prompt", label: "Prompt", type: "textarea", required: true, helper: "Describe the sound or ambience to generate." },
      { name: "duration", label: "Duration", type: "number", defaultValue: 8, min: 1, max: 30, unit: "s", helper: "Length of the generated audio." },
      { name: "negative_prompt", label: "Avoid", type: "textarea", defaultValue: "", advanced: true, helper: "Things the audio should NOT contain, e.g. music, speech." },
      { name: "cfg_strength", label: "Prompt strength", type: "number", defaultValue: 4.5, min: 1, max: 10, step: 0.5, advanced: true, helper: "Higher follows the prompt more literally." },
      { name: "num_steps", label: "Quality steps", type: "integer", defaultValue: 25, min: 4, max: 50, advanced: true, helper: "More steps = higher quality, slower generation." },
      { name: "seed", label: "Seed", type: "integer", advanced: true, helper: "Same seed + same prompt reproduces the same result." },
      { name: "mask_away_clip", label: "Mask away clip", type: "boolean", defaultValue: false, advanced: true, helper: "Ignore CLIP conditioning for a freer interpretation." }
    ]
  },
  "seed-restyle": {
    modelId: "seed-restyle",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "style", label: "Style", type: "string", required: true, helper: "Delivery to restyle into, e.g. slow calm whisper." },
      ...sourceContextFields,
      ...seedQualityFields
    ]
  },
  "seed-voice-changer": {
    modelId: "seed-voice-changer",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      { name: "language", label: "Language", type: "enum", defaultValue: "en", options: ["en", "zh"], helper: "Language of the source speech." },
      { name: "preserve_pacing", label: "Preserve pacing", type: "boolean", defaultValue: false, helper: "Keep the original rhythm and timing of the speech." },
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
      { name: "target_language", label: "Target language", type: "enum", required: true, defaultValue: "English", options: ["English", "Chinese"], helper: "Seed Audio dubs reliably to English and Chinese only." },
      { name: "fit_to_length", label: "Fit to source length", type: "boolean", defaultValue: true, helper: "Ask the model to match the original clip's duration so the dub keeps its slot." },
      { name: "mode", label: "Mode", type: "enum", defaultValue: "fast", options: ["fast"], advanced: true, helper: "Dubbing pipeline variant." },
      ...sourceContextFields,
      ...seedQualityFields
    ]
  },
  "seed-extend": {
    modelId: "seed-extend",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      {
        name: "direction",
        label: "What happens next",
        type: "textarea",
        maxLength: 500,
        helper: "Describe where the continuation should go — a topic or direction, not exact words. Seed Audio keeps the source voice and invents new on-topic speech; it won't read a script. Leave empty to continue naturally."
      },
      { name: "add_seconds", label: "Add", type: "integer", defaultValue: 15, min: 1, max: 60, unit: "s", helper: "Roughly how many seconds of new audio to generate." },
      ...sourceContextFields,
      ...seedQualityFields
    ]
  },
  "seed-inpaint": {
    modelId: "seed-inpaint",
    endpoint: seedEndpoint,
    outputAudioPaths: ["audio", "audio_file", "output", "url"],
    fields: [
      {
        name: "fill_instruction",
        label: "What fills the gap",
        type: "textarea",
        maxLength: 500,
        helper: "Describe what belongs in the selected gap — e.g. \"a calm apology\" or \"a suspenseful line\". Descriptive, not a command: Seed Audio generates it in the source voice and won't read your text verbatim. Leave empty to reconstruct naturally."
      },
      {
        name: "verbatim",
        label: "Speak exact words",
        type: "boolean",
        defaultValue: false,
        helper: "On: the box above is spoken verbatim in the source voice (for a precise name/word fix). Off: it's a description."
      },
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
      { name: "prompt", label: "Prompt", type: "textarea", required: true, helper: "How the source audio should be transformed." },
      variationsField,
      ...sourceContextFields,
      { name: "total_seconds", label: "Duration", type: "number", min: 1, max: 190, unit: "s", advanced: true, helper: "Leave empty to keep the source length." },
      { name: "strength", label: "Transform strength", type: "number", defaultValue: 0.8, min: 0, max: 1, step: 0.05, advanced: true, helper: "Low keeps the source recognizable, high rewrites it." },
      { name: "guidance_scale", label: "Prompt strength", type: "number", defaultValue: 1, min: 1, max: 25, step: 0.5, advanced: true, helper: "Higher follows the prompt more literally." },
      { name: "num_inference_steps", label: "Quality steps", type: "integer", defaultValue: 8, min: 4, max: 25, advanced: true, helper: "More steps = higher quality, slower generation." },
      { name: "seed", label: "Seed", type: "integer", advanced: true, helper: "Same seed + same prompt reproduces the same result." },
      { name: "sync_mode", label: "Sync mode", type: "boolean", defaultValue: false, advanced: true, helper: "Return the audio in the response instead of a hosted file." }
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
      { name: "language", label: "Language", type: "string", advanced: true, helper: "ISO code like en, tr. Leave empty to auto-detect." },
      { name: "num_speakers", label: "Speakers", type: "integer", min: 1, max: 10, advanced: true, helper: "Expected number of distinct speakers. Leave empty to auto-detect." },
      { name: "batch_size", label: "Batch size", type: "integer", defaultValue: 64, advanced: true, helper: "Processing chunk size; larger is faster but uses more memory." },
      { name: "prompt", label: "Vocabulary hint", type: "string", defaultValue: "", advanced: true, helper: "Names and jargon to help the transcriber spell correctly." }
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
