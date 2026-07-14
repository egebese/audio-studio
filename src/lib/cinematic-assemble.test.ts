import { describe, it, expect } from "vitest";
import { assembleCinematic, type AssembleParts } from "./cinematic-assemble";
import { validateCinematicSpec } from "./cinematic-spec";

const spec = validateCinematicSpec({
  name: "TEST — Piece",
  voiceTrackName: "Narration",
  anchor: { prompt: 'The narrator (deep) narrates: "Hook."' },
  voice: [
    { model: "seed-tts", prompt: 'The narrator (voiced by @Audio1) narrates: "One."', clone: true, gap: 0.5 },
    { model: "seed-scene", prompt: "[room] A (american accent) says: \"Two.\"", climax: true, gap: 0.7 }
  ],
  score: { prompt: "epic", seconds: 30 },
  layers: [{ model: "mmaudio", name: "Ambience", duck: "ambience", place: "bed", prompt: "wind", seconds: 12 }],
  outro: { prompt: 'The narrator (voiced by @Audio1) narrates: "Reveal."' }
});

// Voice at level 0.03; score/ambience much louder (0.10) like real seed vs stable output.
const parts: AssembleParts = {
  voice: [
    { url: "v0", full: 6, level: 0.03, offset: 0.2, dur: 4 },
    { url: "v1", full: 8, level: 0.03, offset: 0.3, dur: 5 }
  ],
  reveal: { url: "rev", full: 9, level: 0.03, offset: 0.4, dur: 3 },
  score: { url: "score", full: 30, level: 0.1, start: 0, dur: 30 },
  layers: [{ url: "amb", full: 12, level: 0.1, start: 0, dur: 12 }]
};

describe("assembleCinematic", () => {
  const snap = assembleCinematic(spec, "proj_test", parts, "2026-01-01T00:00:00.000Z");
  const trackById = Object.fromEntries(snap.tracks.map((t) => [t.id, t]));
  const playedDb = (clip: { assetId: string; gain: number }, assetLevel: number, V: number) =>
    20 * Math.log10((assetLevel * clip.gain) / V);

  it("builds voice + score + closing + one ambience track", () => {
    expect(snap.tracks.map((t) => t.name)).toEqual(["Narration", "Score", "Closing", "Ambience"]);
    expect(snap.project.name).toBe("TEST — Piece");
  });

  it("omits the score and closing tracks when those parts are absent", () => {
    const leanSpec = validateCinematicSpec({
      name: "P",
      voiceTrackName: "Show",
      voice: [{ model: "seed-tts", prompt: "hello there" }],
      layers: [{ model: "mmaudio", name: "Bed", duck: "ambience", place: "bed", prompt: "room", seconds: 12 }]
    });
    const leanParts = {
      voice: [{ url: "v", full: 6, level: 0.03, offset: 0.2, dur: 4 }],
      layers: [{ url: "b", full: 12, level: 0.1, start: 0, dur: 12 }]
    };
    const lean = assembleCinematic(leanSpec, "proj_lean", leanParts, "2026-01-01T00:00:00.000Z");
    expect(lean.tracks.map((t) => t.name)).toEqual(["Show", "Bed"]);
    expect(lean.clips.some((c) => c.assetId.endsWith("_score"))).toBe(false);
    expect(lean.clips.some((c) => c.assetId.endsWith("_reveal"))).toBe(false);
  });

  it("levels the score bed clearly under the voice (~-16 dB)", () => {
    const scoreClips = snap.clips.filter((c) => c.assetId === "proj_test_score");
    const bed = Math.min(...scoreClips.map((c) => c.gain));
    const swell = Math.max(...scoreClips.map((c) => c.gain));
    expect(playedDb({ assetId: "", gain: bed }, 0.1, 0.03)).toBeLessThan(-12); // bed well under VO
    expect(swell).toBeGreaterThan(bed); // swells in the gaps
  });

  it("places the ambience as a full-length bed, well under the voice (~-20 dB)", () => {
    const amb = snap.clips.find((c) => c.assetId === "proj_test_l0")!;
    const total = Math.max(...snap.clips.map((c) => c.start + c.duration));
    expect(amb.start).toBe(0);
    expect(amb.duration).toBeCloseTo(total, 1);
    expect(playedDb(amb, 0.1, 0.03)).toBeLessThan(-16);
  });

  it("keeps voice clips at unity gain (the reference)", () => {
    const voiceClips = snap.clips.filter((c) => trackById[c.trackId].kind === "voice");
    expect(voiceClips.every((c) => c.gain === 1)).toBe(true);
  });
});
