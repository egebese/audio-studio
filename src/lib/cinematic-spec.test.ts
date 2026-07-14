import { describe, it, expect } from "vitest";
import { validateCinematicSpec, specJobCount, SPEC_LIMITS } from "./cinematic-spec";

const good = {
  name: "TRAILER — Test",
  anchor: { prompt: 'The narrator (deep) narrates: "Hook."' },
  voice: [
    { model: "seed-tts", prompt: 'The narrator (voiced by @Audio1) narrates: "Line one."', clone: true },
    { model: "seed-scene", prompt: "[room] A (american accent) says: \"Hi.\"", climax: true }
  ],
  score: { prompt: "epic orchestral", seconds: 30 },
  layers: [{ model: "mmaudio", name: "Ambience", duck: "ambience", place: "bed", prompt: "wind", seconds: 12 }],
  outro: { prompt: 'The narrator (voiced by @Audio1) narrates: "The signal survives the storm."' }
};

describe("validateCinematicSpec", () => {
  it("accepts a well-formed spec and fills defaults", () => {
    const spec = validateCinematicSpec(good);
    expect(spec.voice).toHaveLength(2);
    expect(spec.voiceTrackName).toBe("Voice");
    expect(spec.outro?.gap).toBe(0.7);
    expect(spec.voice[0].clone).toBe(true);
    expect(spec.layers[0].place).toBe("bed");
  });

  it("clamps score seconds and caps voice/layer counts", () => {
    const spec = validateCinematicSpec({
      ...good,
      score: { prompt: "x", seconds: 999 },
      voice: Array.from({ length: 12 }, () => ({ model: "seed-tts", prompt: "hi" })),
      layers: Array.from({ length: 9 }, () => ({ model: "eleven-sfx", name: "s", duck: "impact", place: "climax", text: "boom" }))
    });
    expect(spec.score?.seconds).toBe(SPEC_LIMITS.scoreSecondsMax);
    expect(spec.voice).toHaveLength(SPEC_LIMITS.maxVoiceSegs);
    expect(spec.layers).toHaveLength(SPEC_LIMITS.maxLayers);
  });

  it("requires only voice — anchor, score and outro are optional", () => {
    expect(() => validateCinematicSpec({ ...good, voice: [] })).toThrow(/voice/);
    expect(() => validateCinematicSpec(null)).toThrow();
    const lean = validateCinematicSpec({ name: "P", voice: [{ model: "seed-tts", prompt: "hello there" }], layers: [] });
    expect(lean.anchor).toBeUndefined();
    expect(lean.score).toBeUndefined();
    expect(lean.outro).toBeUndefined();
  });

  it("drops clone flags and @Audio tags when there is no anchor", () => {
    const spec = validateCinematicSpec({
      name: "P",
      voice: [{ model: "seed-tts", clone: true, prompt: 'The host (voiced by @Audio1) narrates: "Hi there."' }],
      layers: []
    });
    expect(spec.voice[0].clone).toBe(false);
    expect(spec.voice[0].prompt).not.toContain("@Audio");
  });

  it("suppresses anchors and cloning when character aliases enable cast mode", () => {
    const spec = validateCinematicSpec(
      {
        ...good,
        voice: [
          {
            model: "seed-scene",
            clone: true,
            useAnchor: true,
            prompt: '@jade navigator answers @CAPTAIN VALE, then @Vale says: "Ready." @Ignored Fourth waits.'
          }
        ]
      },
      { characterNames: [" Jade Navigator ", "jade navigator", "Captain Vale", "Vale", "Ignored Fourth"] }
    );

    expect(spec.anchor).toBeUndefined();
    expect(spec.voice[0]).toMatchObject({
      clone: false,
      useAnchor: false,
      prompt: '@Jade Navigator answers @Captain Vale, then @Vale says: "Ready." Ignored Fourth waits.'
    });
    // Cast specs do not pay for an anchor generation.
    expect(specJobCount(spec)).toBe(6);
  });

  it("keeps known cast aliases but removes old audio and unknown mention markers", () => {
    const spec = validateCinematicSpec(
      {
        ...good,
        voice: [
          {
            model: "seed-scene",
            prompt: '@NORA speaks to @Unknown while @Audio2 waits.'
          }
        ],
        outro: { prompt: "@unknown signs off after @nora and @Audio1." }
      },
      { characterNames: [" Nora "] }
    );

    expect(spec.voice[0].prompt).toBe("@Nora speaks to Unknown while waits.");
    expect(spec.outro?.prompt).toBe("unknown signs off after @Nora and.");
  });

  it("treats an empty normalized character list as zero-cast mode", () => {
    const spec = validateCinematicSpec(good, { characterNames: [" ", "\t", ""] });

    expect(spec.anchor).toEqual(good.anchor);
    expect(spec.voice[0].clone).toBe(true);
    expect(spec.voice[0].prompt).toContain("@Audio1");
  });

  it("requires the right content field per layer model", () => {
    expect(() =>
      validateCinematicSpec({ ...good, layers: [{ model: "mmaudio", name: "a", duck: "ambience", place: "bed" }] })
    ).toThrow(/mmaudio/);
    expect(() =>
      validateCinematicSpec({ ...good, layers: [{ model: "eleven-sfx", name: "a", duck: "impact", place: "climax" }] })
    ).toThrow(/eleven-sfx/);
  });

  it("counts jobs: anchor + voices + reveal + score + layers + crops", () => {
    // 1 anchor + 2 voice + 1 reveal + 1 score + 1 layer + 2 voice crops + 1 reveal crop = 9
    expect(specJobCount(validateCinematicSpec(good))).toBe(9);
  });

  it("parses + clamps extend, and omits it when absent or zero", () => {
    const withExtend = validateCinematicSpec({
      ...good,
      voice: [{ model: "seed-tts", prompt: "hi", extend: { seconds: 99, direction: "keep going" } }]
    });
    expect(withExtend.voice[0].extend).toEqual({ seconds: SPEC_LIMITS.extendMax, direction: "keep going" });
    // +2 jobs for the one extended segment
    expect(specJobCount(withExtend)).toBe(1 + 1 + 1 + 1 + 1 + 1 + 1 + 2);

    const noExtend = validateCinematicSpec({ ...good, voice: [{ model: "seed-tts", prompt: "hi", extend: { seconds: 0 } }] });
    expect(noExtend.voice[0].extend).toBeUndefined();
  });
});
