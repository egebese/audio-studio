import { describe, expect, it } from "vitest";
import { enhancePrompt, lintPrompt } from "./prompt-intelligence";

describe("prompt intelligence", () => {
  it("blocks famous/public IP terms", () => {
    const result = lintPrompt("seed-scene", "Make Batman speak in a trailer");
    expect(result.blocked).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/famous|copyrighted/i);
  });

  it("warns when Seed scene prompts omit accents", () => {
    const result = lintPrompt("seed-scene", "Two hosts argue in a studio");
    expect(result.warnings).toContain(
      "Scene prompts should include an explicit accent for every speaker."
    );
  });

  it("blocks overlong Seed prompts", () => {
    expect(lintPrompt("seed-scene", "a".repeat(2049)).blocked).toBe(true);
  });

  it("enhances SFX prompts with concrete production constraints", () => {
    expect(enhancePrompt("eleven-sfx", "glass shatter")).toContain("natural decay");
  });

  it("turns loose Seed scene ideas into finished scene prompts", () => {
    const prompt = enhancePrompt(
      "seed-scene",
      "tense sci-fi trailer: Earth is dying, humanity searches for a new planet"
    );

    expect(prompt).toMatch(/^\[/);
    expect(prompt).toContain("American accent");
    expect(prompt).toMatch(/"[^"]+"/);
    expect(prompt).toContain("[engine roar spools up]");
    expect(prompt.length).toBeLessThanOrEqual(2048);
  });

  it("tags cloned voices in Seed cast scene prompts", () => {
    const prompt = enhancePrompt("seed-cast-scene", "two podcast hosts trade an embarrassing story", [
      "Dex",
      "Robin"
    ]);

    expect(prompt).toContain("Dex");
    expect(prompt).toContain("Robin");
    expect(prompt).toContain("voiced by @Audio1");
    expect(prompt).toContain("voiced by @Audio2");
    expect(prompt).toContain("American accent");
    expect(prompt.length).toBeLessThanOrEqual(2048);
  });

  it("keeps a news handoff sequence in the local Seed fallback", () => {
    const prompt = enhancePrompt(
      "seed-scene",
      "create a news report, first sound is male news presentor then it gies the scene to sport reporter which is also black male. then woman weather speaker."
    );

    expect(prompt).toContain("Marcus Reed");
    expect(prompt).toContain("Jamal Price");
    expect(prompt).toContain("Black male");
    expect(prompt).toContain("Maya Cole");
    expect(prompt).toMatch(/newsroom.+Jamal.+Maya/s);
  });
});
