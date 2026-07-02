import { describe, expect, it } from "vitest";
import { modelCatalog } from "./model-catalog";
import { coerceSchemaInput, getModelSchema, schemaDefaults } from "./model-schemas";

describe("model schemas", () => {
  it("covers every catalog model and matches its endpoint", () => {
    for (const model of modelCatalog) {
      const schema = getModelSchema(model.id);
      expect(schema.endpoint).toBe(model.endpoint);
      expect(schema.fields.length).toBeGreaterThan(0);
    }
  });

  it("coerces booleans, integers, enums, JSON, and drops empty optional fields", () => {
    const result = coerceSchemaInput("minimax-music", {
      prompt: "cinematic folk ballad",
      is_instrumental: "true",
      lyrics_optimizer: "false",
      audio_setting: "{\"sample_rate\":44100}",
      lyrics: ""
    });

    expect(result.errors).toEqual([]);
    expect(result.input).toMatchObject({
      prompt: "cinematic folk ballad",
      is_instrumental: true,
      lyrics_optimizer: false,
      audio_setting: { sample_rate: 44100 }
    });
    expect(result.input).not.toHaveProperty("lyrics");
    expect(result.input).not.toHaveProperty("enhance");
  });

  it("validates required fields and enum options", () => {
    expect(coerceSchemaInput("eleven-sfx", {}).errors[0]).toMatch(/SFX prompt is required/);
    expect(
      coerceSchemaInput("seed-dub", {
        target_language: "Spanish",
        mode: "faithful",
        source_audio_url: "https://example.com/source.wav"
      }).errors[0]
    ).toMatch(/Mode must be one of: fast/);
  });

  it("returns hidden fal defaults for Seed use cases", () => {
    expect(schemaDefaults("seed-scene")).toMatchObject({
      sample_rate: 48000,
      output_format: "wav",
      enhance: true
    });
  });
});
