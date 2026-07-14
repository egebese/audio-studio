import type { ModelKind, TrackKind } from "./types";

export interface ModelDefinition {
  id: string;
  kind: ModelKind;
  provider: string;
  providerIconKey?: string;
  label: string;
  description: string;
  endpoint: string;
  task: "scene" | "speech" | "music" | "sfx" | "image-voice" | "restyle" | "dub" | "voice-change" | "extend" | "inpaint" | "asr" | "clone";
  defaultTrack?: TrackKind;
  needsSource?: boolean;
  needsRegion?: boolean;
  needsVoice?: boolean;
  enhancesPrompt?: boolean;
  featured?: boolean;
  media?: { poster: string; video?: string };
  bestFor: string[];
  capabilities: string[];
  durationHint?: string;
  referenceHint?: string;
  routingKeywords: string[];
}

export const seedAudioEndpoint = "bytedance/seed-audio-1.0";

export const modelCatalog: ModelDefinition[] = [
  {
    id: "seed-scene",
    kind: "generate",
    provider: "Seed Audio 1.0",
    providerIconKey: "volcengine",
    label: "Seed Scene",
    description: "Dialogue, ambience, music and SFX in one prompt.",
    endpoint: seedAudioEndpoint,
    task: "scene",
    defaultTrack: "voice",
    enhancesPrompt: true,
    featured: true,
    media: { poster: "/featured/seed-scene.webp", video: "/featured/seed-scene.mp4" },
    bestFor: ["Dialogue scene", "Narrative", "Mixed bed"],
    capabilities: ["Prompt", "Speech", "Music", "SFX"],
    durationHint: "~2m",
    routingKeywords: ["dialogue", "scene", "podcast", "trailer", "character"]
  },
  {
    id: "seed-cast-scene",
    kind: "generate",
    provider: "Seed Audio 1.0",
    providerIconKey: "volcengine",
    label: "Seed Cast Scene",
    description: "Multi-voice scene using selected cloned voices.",
    endpoint: seedAudioEndpoint,
    task: "scene",
    defaultTrack: "voice",
    needsVoice: true,
    enhancesPrompt: true,
    featured: true,
    media: { poster: "/featured/seed-cast-scene.webp", video: "/featured/seed-cast-scene.mp4" },
    bestFor: ["Cloned cast", "Dialogue scene"],
    capabilities: ["Voice", "Prompt", "Speech"],
    durationHint: "~2m",
    referenceHint: "Needs selected voice",
    routingKeywords: ["cast", "clone", "multi voice", "conversation"]
  },
  {
    id: "seed-tts",
    kind: "generate",
    provider: "Seed Audio 1.0",
    providerIconKey: "volcengine",
    label: "Seed TTS",
    description: "Plain single-voice text to speech.",
    endpoint: seedAudioEndpoint,
    task: "speech",
    defaultTrack: "voice",
    enhancesPrompt: true,
    bestFor: ["Narration", "Single voice", "Clean speech"],
    capabilities: ["Prompt", "Speech", "TTS"],
    durationHint: "~2m",
    routingKeywords: ["tts", "text to speech", "read aloud", "narration", "voiceover", "single voice"]
  },
  {
    id: "seed-image-voice",
    kind: "generate",
    provider: "Seed Audio 1.0",
    providerIconKey: "volcengine",
    label: "Image Voice",
    description: "Speak text in a voice conditioned by an image URL.",
    endpoint: seedAudioEndpoint,
    featured: true,
    media: { poster: "/featured/seed-image-voice.webp", video: "/featured/seed-image-voice.mp4" },
    task: "image-voice",
    defaultTrack: "voice",
    bestFor: ["Character voice", "Image reference"],
    capabilities: ["Image", "Speech"],
    durationHint: "~2m",
    referenceHint: "Image URL",
    routingKeywords: ["image", "character voice", "portrait"]
  },
  {
    id: "eleven-tts",
    kind: "generate",
    provider: "ElevenLabs",
    label: "ElevenLabs TTS",
    description: "High quality narration and speech.",
    endpoint: "fal-ai/elevenlabs/tts/eleven-v3",
    task: "speech",
    defaultTrack: "voice",
    bestFor: ["Narration", "Clean speech"],
    capabilities: ["Speech", "TTS"],
    durationHint: "Fast",
    routingKeywords: ["narration", "voiceover", "speech", "tts"]
  },
  {
    id: "eleven-sfx",
    kind: "generate",
    provider: "ElevenLabs",
    label: "ElevenLabs SFX",
    description: "Standalone sound effects from text.",
    endpoint: "fal-ai/elevenlabs/sound-effects/v2",
    task: "sfx",
    defaultTrack: "sfx",
    enhancesPrompt: true,
    bestFor: ["SFX", "Foley", "Impact"],
    capabilities: ["Prompt", "SFX"],
    durationHint: "Short",
    routingKeywords: ["sfx", "effect", "impact", "foley", "sound"]
  },
  {
    id: "stable-audio",
    kind: "generate",
    provider: "Stable Audio 2.5",
    providerIconKey: "stability",
    label: "Stable Audio",
    description: "Music beds, textures and long-form audio.",
    endpoint: "fal-ai/stable-audio-25/text-to-audio",
    task: "music",
    defaultTrack: "music",
    enhancesPrompt: true,
    bestFor: ["Music bed", "Texture", "Soundscape"],
    capabilities: ["Prompt", "Music", "SFX"],
    durationHint: "Variable",
    routingKeywords: ["music", "bed", "texture", "loop", "soundscape"]
  },
  {
    id: "minimax-music",
    kind: "generate",
    provider: "MiniMax Music 2.6",
    providerIconKey: "minimax",
    label: "MiniMax Music",
    description: "Full songs with vocals and arrangements.",
    endpoint: "fal-ai/minimax-music/v2.6",
    task: "music",
    defaultTrack: "music",
    enhancesPrompt: true,
    bestFor: ["Full song", "Vocals", "Arrangement"],
    capabilities: ["Prompt", "Music", "Vocals"],
    durationHint: "Song",
    routingKeywords: ["song", "lyrics", "vocal", "arrangement"]
  },
  {
    id: "mmaudio",
    kind: "generate",
    provider: "MMAudio",
    label: "MMAudio",
    description: "Fast descriptive audio generation.",
    endpoint: "fal-ai/mmaudio-v2/text-to-audio",
    task: "sfx",
    defaultTrack: "sfx",
    bestFor: ["Quick audio", "Descriptive SFX"],
    capabilities: ["Prompt", "SFX"],
    durationHint: "Fast",
    routingKeywords: ["quick", "sync", "ambient", "descriptive"]
  },
  {
    id: "seed-restyle",
    kind: "transform",
    provider: "Seed Audio 1.0",
    providerIconKey: "volcengine",
    label: "Restyle",
    description: "Keep the words, change delivery.",
    endpoint: seedAudioEndpoint,
    featured: true,
    media: { poster: "/featured/seed-restyle.webp", video: "/featured/seed-restyle.mp4" },
    task: "restyle",
    needsSource: true,
    bestFor: ["Delivery", "Same voice"],
    capabilities: ["Source", "ASR", "Speech"],
    durationHint: "~2m",
    referenceHint: "Uses source voice",
    routingKeywords: ["restyle", "whisper", "shout", "delivery"]
  },
  {
    id: "seed-voice-changer",
    kind: "transform",
    provider: "Seed Audio 1.0",
    providerIconKey: "volcengine",
    label: "Voice Changer",
    description: "Re-speak source words in a target voice.",
    endpoint: seedAudioEndpoint,
    featured: true,
    media: { poster: "/featured/seed-voice-changer.webp", video: "/featured/seed-voice-changer.mp4" },
    task: "voice-change",
    needsSource: true,
    needsVoice: true,
    bestFor: ["Voice clone", "Re-voice"],
    capabilities: ["Source", "Voice", "ASR"],
    durationHint: "~2m",
    referenceHint: "Needs target voice",
    routingKeywords: ["voice change", "target voice", "clone"]
  },
  {
    id: "seed-dub",
    kind: "transform",
    provider: "Seed Audio 1.0",
    providerIconKey: "volcengine",
    label: "Dubbing",
    description: "Translate while keeping the original voice.",
    endpoint: seedAudioEndpoint,
    featured: true,
    media: { poster: "/featured/seed-dub.webp", video: "/featured/seed-dub.mp4" },
    task: "dub",
    needsSource: true,
    bestFor: ["Dubbing", "Translation"],
    capabilities: ["Source", "Speech"],
    durationHint: "~2m",
    referenceHint: "Uses source voice",
    routingKeywords: ["dub", "translate", "language"]
  },
  {
    id: "seed-extend",
    kind: "transform",
    provider: "Seed Audio 1.0",
    providerIconKey: "volcengine",
    label: "Extend",
    description: "Continue source audio in the same voice and topic.",
    endpoint: seedAudioEndpoint,
    task: "extend",
    needsSource: true,
    featured: true,
    media: { poster: "/featured/seed-extend.webp", video: "/featured/seed-extend.mp4" },
    bestFor: ["Continuation", "Same speaker"],
    capabilities: ["Source", "Voice context"],
    durationHint: "~2m/call",
    referenceHint: "Uses source as voice context",
    routingKeywords: ["extend", "continue", "longer"]
  },
  {
    id: "seed-inpaint",
    kind: "transform",
    provider: "Seed Audio 1.0",
    providerIconKey: "volcengine",
    label: "Inpaint",
    description: "Fill a selected gap or region.",
    endpoint: seedAudioEndpoint,
    task: "inpaint",
    needsSource: true,
    needsRegion: true,
    featured: true,
    media: { poster: "/featured/seed-inpaint.webp", video: "/featured/seed-inpaint.mp4" },
    bestFor: ["Repair", "Gap fill"],
    capabilities: ["Source", "Region", "Speech"],
    durationHint: "~2m",
    referenceHint: "Needs selected gap",
    routingKeywords: ["inpaint", "fill", "repair"]
  },
  {
    id: "stable-audio-to-audio",
    kind: "transform",
    provider: "Stable Audio 2.5",
    providerIconKey: "stability",
    label: "Stable Audio-to-Audio",
    description: "Transform music or SFX from an audio source.",
    endpoint: "fal-ai/stable-audio-25/audio-to-audio",
    task: "restyle",
    needsSource: true,
    bestFor: ["Music transform", "SFX texture"],
    capabilities: ["Source", "Music", "SFX"],
    durationHint: "Variable",
    referenceHint: "Uses source audio",
    routingKeywords: ["music transform", "audio to audio", "texture"]
  },
  {
    id: "whisper-asr",
    kind: "utility",
    provider: "fal",
    providerIconKey: "fal",
    label: "Transcribe",
    description: "Speech to text for transcripts and checks.",
    endpoint: "fal-ai/whisper",
    task: "asr",
    needsSource: true,
    bestFor: ["Transcript", "Speaker edit"],
    capabilities: ["Source", "ASR", "Diarize"],
    durationHint: "Fast",
    referenceHint: "Speech assets only",
    routingKeywords: ["transcribe", "asr", "captions"]
  }
];

export function getModel(id: string): ModelDefinition | undefined {
  return modelCatalog.find((model) => model.id === id);
}

export function routeModelForPrompt(prompt: string): ModelDefinition {
  const lower = prompt.toLowerCase();
  const scored = modelCatalog
    .filter((model) => model.kind === "generate")
    .map((model) => ({
      model,
      score: model.routingKeywords.reduce(
        (sum, keyword) => sum + (lower.includes(keyword) ? 1 : 0),
        0
      )
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].model : modelCatalog[0];
}
