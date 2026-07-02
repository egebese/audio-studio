import { describe, expect, it } from "vitest";
import { getModel, modelCatalog } from "./model-catalog";
import { filterModels, lobeProviderIconKey, modelLettermark } from "./model-picker";

describe("model picker helpers", () => {
  it("filters by search, provider, task and best-for", () => {
    expect(filterModels(modelCatalog, { query: "song" }).map((model) => model.id)).toContain("minimax-music");
    expect(filterModels(modelCatalog, { provider: "ElevenLabs" }).every((model) => model.provider === "ElevenLabs")).toBe(true);
    expect(filterModels(modelCatalog, { task: "extend" }).map((model) => model.id)).toEqual(["seed-extend"]);
    expect(filterModels(modelCatalog, { bestFor: "Gap fill" }).map((model) => model.id)).toEqual(["seed-inpaint"]);
  });

  it("resolves supported Lobe icon keys and falls back to a lettermark", () => {
    expect(lobeProviderIconKey(getModel("minimax-music")!)).toBe("minimax");
    expect(lobeProviderIconKey(getModel("whisper-asr")!)).toBeUndefined();
    expect(modelLettermark(getModel("whisper-asr")!)).toBe("F");
  });
});
