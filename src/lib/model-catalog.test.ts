import { describe, expect, it } from "vitest";
import { getModel, modelCatalog, routeModelForPrompt, seedAudioEndpoint } from "./model-catalog";

describe("model catalog", () => {
  it("contains the planned model lanes", () => {
    expect(getModel("seed-scene")?.kind).toBe("generate");
    expect(getModel("seed-restyle")?.kind).toBe("transform");
    expect(getModel("whisper-asr")?.kind).toBe("utility");
    expect(modelCatalog.some((model) => model.provider === "MiniMax Music 2.6")).toBe(true);
  });

  it("routes obvious prompts to task defaults", () => {
    expect(routeModelForPrompt("full vocal song with lyrics").id).toBe("minimax-music");
    expect(routeModelForPrompt("single glass impact sfx").id).toBe("eleven-sfx");
  });

  it("routes every Seed Audio use case through the base endpoint", () => {
    const seedModels = modelCatalog.filter((model) => model.id.startsWith("seed-"));
    expect(seedModels.map((model) => [model.id, model.endpoint])).toEqual(
      expect.arrayContaining([
        ["seed-scene", seedAudioEndpoint],
        ["seed-cast-scene", seedAudioEndpoint],
        ["seed-image-voice", seedAudioEndpoint],
        ["seed-restyle", seedAudioEndpoint],
        ["seed-voice-changer", seedAudioEndpoint],
        ["seed-dub", seedAudioEndpoint],
        ["seed-extend", seedAudioEndpoint],
        ["seed-inpaint", seedAudioEndpoint]
      ])
    );
    expect(seedModels.every((model) => model.endpoint === seedAudioEndpoint)).toBe(true);
  });
});
