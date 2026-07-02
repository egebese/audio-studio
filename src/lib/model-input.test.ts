import { describe, expect, it } from "vitest";
import { getModel } from "./model-catalog";
import { buildModelRunInput } from "./model-input";
import type { Asset, Clip, Voice } from "./types";

const clip: Clip = {
  id: "clip",
  trackId: "track_voice",
  assetId: "asset_source",
  start: 10,
  duration: 8,
  offset: 3,
  gain: 1,
  fadeIn: 0,
  fadeOut: 0
};

const voice: Voice = {
  id: "voice",
  projectId: "project",
  name: "Reporter",
  refAssetId: "asset_voice",
  provider: "local",
  createdAt: "now"
};

const voiceAsset: Asset = {
  id: "asset_voice",
  projectId: "project",
  kind: "audio",
  name: "Reporter",
  url: "https://example.com/voice.wav",
  duration: 12,
  source: "derived",
  createdAt: "now"
};

describe("model input builder", () => {
  it("builds Seed Extend payload from the selected source context", () => {
    const model = getModel("seed-extend")!;
    const built = buildModelRunInput({
      model,
      values: { add_seconds: 22, direction: "toward a sharper outro" },
      source: { url: "https://example.com/source.wav", clipLocal: true, sourceOffset: 3, duration: 8 },
      selectedClip: clip,
      selectedVoice: voice,
      voiceAsset
    });

    expect(built.errors).toEqual([]);
    const { input } = built;
    expect(input).toMatchObject({
      source_audio_url: "https://example.com/source.wav",
      audio_url: "https://example.com/source.wav",
      add_seconds: 22,
      direction: "toward a sharper outro",
      sample_rate: 48000,
      output_format: "wav",
      source_duration_s: 8
    });
    expect(input).not.toHaveProperty("target_voice_url");
    expect(input).not.toHaveProperty("audio_urls");
    expect(input).not.toHaveProperty("voices");
  });

  it("keeps source audio and target voice separate for Voice Changer", () => {
    const model = getModel("seed-voice-changer")!;
    const built = buildModelRunInput({
      model,
      values: { language: "en", preserve_pacing: false },
      source: { url: "https://example.com/source.wav", clipLocal: false, sourceOffset: 0, duration: 8 },
      selectedClip: clip,
      selectedVoice: voice,
      voiceAsset
    });

    expect(built.errors).toEqual([]);
    const { input } = built;
    expect(input.source_audio_url).toBe("https://example.com/source.wav");
    expect(input.audio_url).toBe("https://example.com/source.wav");
    expect(input.target_voice_url).toBe("https://example.com/voice.wav");
    expect(input.target_voice_duration_s).toBe(12);
    expect(input.voices).toEqual([{ name: "Reporter", ref_url: "https://example.com/voice.wav" }]);
    expect(input).not.toHaveProperty("audio_urls");
  });

  it("coerces schema fields before adding context", () => {
    const model = getModel("minimax-music")!;
    const built = buildModelRunInput({
      model,
      values: {
        prompt: "dusty synth pop",
        lyrics_optimizer: false,
        is_instrumental: true,
        audio_setting: "{\"sample_rate\":44100}"
      }
    });

    expect(built.errors).toEqual([]);
    expect(built.input).toMatchObject({
      prompt: "dusty synth pop",
      is_instrumental: true,
      lyrics_optimizer: false,
      audio_setting: { sample_rate: 44100 }
    });
  });
});
