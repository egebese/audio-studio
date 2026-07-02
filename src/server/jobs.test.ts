import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { fal } from "@fal-ai/client";
import { buildProviderInput, createJob, runJob, validateJobRequest } from "./jobs";

vi.mock("@fal-ai/client", () => ({
  fal: {
    subscribe: vi.fn(),
    storage: {
      upload: vi.fn()
    }
  }
}));

const originalFalKey = process.env.FAL_KEY;

afterEach(() => {
  if (originalFalKey === undefined) delete process.env.FAL_KEY;
  else process.env.FAL_KEY = originalFalKey;
  (fal.subscribe as unknown as Mock).mockReset();
  (fal.storage.upload as unknown as Mock).mockReset();
});

describe("job state", () => {
  it("fails fast without FAL_KEY instead of creating mock output", async () => {
    delete process.env.FAL_KEY;
    const job = createJob({
      modelId: "eleven-sfx",
      operation: "sfx",
      input: { text: "metal door slam" }
    });

    const done = await runJob(job.id);

    expect(done.status).toBe("error");
    expect(done.error).toBe("FAL_KEY is required for live model jobs");
    expect(done.outputs).toEqual([]);
    expect(fal.subscribe).not.toHaveBeenCalled();
  });

  it("rejects invalid job contracts before creation", () => {
    expect(
      validateJobRequest({
        modelId: "missing",
        operation: "sfx",
        input: {}
      })
    ).toMatch(/Unknown model/);
    expect(
      validateJobRequest({
        modelId: "eleven-sfx",
        operation: "music",
        input: { text: "hit" }
      })
    ).toMatch(/does not match/);
    expect(
      validateJobRequest({
        modelId: "eleven-sfx",
        operation: "sfx",
        input: {}
      })
    ).toMatch(/SFX prompt is required/);
  });

  it("does not accept sourceAssetIds without a real source audio URL", () => {
    expect(
      validateJobRequest({
        modelId: "seed-restyle",
        operation: "restyle",
        input: { style: "calm whisper" },
        sourceAssetIds: ["asset_source"]
      })
    ).toBe("A source audio URL is required");
  });

  it("validates enum values through the schema registry", () => {
    expect(
      validateJobRequest({
        modelId: "seed-dub",
        operation: "dub",
        input: {
          target_language: "Spanish",
          mode: "faithful",
          source_audio_url: "https://example.com/source.wav"
        }
      })
    ).toMatch(/Mode must be one of: fast/);
  });

  it("coerces and drops optional model input when creating a job", () => {
    const job = createJob({
      modelId: "minimax-music",
      operation: "music",
      input: {
        prompt: "lofi ballad",
        lyrics: "",
        is_instrumental: "true",
        lyrics_optimizer: "false",
        audio_setting: "{\"sample_rate\":44100}"
      }
    });

    expect(job.input).toMatchObject({
      prompt: "lofi ballad",
      is_instrumental: true,
      lyrics_optimizer: false,
      audio_setting: { sample_rate: 44100 }
    });
    expect(job.input).not.toHaveProperty("lyrics");
  });

  it("builds Seed Extend and Inpaint from the base endpoint schema", async () => {
    await expect(
      buildProviderInput("seed-extend", {
        source_audio_url: "https://example.com/source.wav",
        add_seconds: 12,
        direction: "move into a colder room",
        sample_rate: 48000,
        output_format: "wav"
      })
    ).resolves.toMatchObject({
      prompt: expect.stringContaining("@Audio1 Continue"),
      audio_urls: ["https://example.com/source.wav"],
      sample_rate: 48000,
      output_format: "wav"
    });

    await expect(
      buildProviderInput("seed-inpaint", {
        source_audio_url: "https://example.com/source.wav",
        gap_start_s: 1.25,
        gap_end_s: 2.5,
        fill_instruction: "a clean breath and one short word",
        sample_rate: 48000,
        output_format: "wav"
      })
    ).resolves.toMatchObject({
      prompt: expect.stringContaining("missing section from 1.25s to 2.50s"),
      audio_urls: ["https://example.com/source.wav"]
    });
  });

  it("builds ASR-backed Seed restyle and voice changer payloads", async () => {
    (fal.subscribe as unknown as Mock).mockResolvedValue({ data: { text: "hello from the source" } });

    await expect(
      buildProviderInput("seed-restyle", {
        source_audio_url: "https://example.com/source.wav",
        style: "sleepy radio host",
        sample_rate: 48000,
        output_format: "wav"
      })
    ).resolves.toEqual({
      prompt: "@Audio1 Say the following, but sleepy radio host: \"hello from the source\"",
      audio_urls: ["https://example.com/source.wav"],
      sample_rate: 48000,
      output_format: "wav"
    });

    await expect(
      buildProviderInput("seed-voice-changer", {
        source_audio_url: "https://example.com/source.wav",
        target_voice_url: "https://example.com/voice.wav",
        sample_rate: 48000,
        output_format: "wav"
      })
    ).resolves.toEqual({
      prompt: "@Audio1 hello from the source",
      audio_urls: ["https://example.com/voice.wav"],
      sample_rate: 48000,
      output_format: "wav"
    });
  });
});
