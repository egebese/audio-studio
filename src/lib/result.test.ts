import { describe, expect, it } from "vitest";
import { normalizeModelOutput } from "./result";

describe("result normalization", () => {
  it("normalizes Seed-style audio output", () => {
    expect(
      normalizeModelOutput({ audio: { url: "https://x/out.wav", duration: 3 } })
    ).toMatchObject([{ url: "https://x/out.wav", duration: 3 }]);
  });

  it("normalizes direct audio string output", () => {
    expect(normalizeModelOutput({ audio: "https://x/out.wav" })[0].url).toBe(
      "https://x/out.wav"
    );
  });

  it("normalizes transcript-only Whisper output", () => {
    const [output] = normalizeModelOutput({
      text: "first second",
      chunks: [{ text: "first", start: 0, end: 1 }],
      diarization_segments: [{ speaker: "SPEAKER_00", start: 0, end: 1 }]
    });

    expect(output.url).toBeUndefined();
    expect(output.transcript).toBe("first second");
    expect(output.transcriptSegments?.[0]).toMatchObject({ speaker: "Speaker 1" });
  });
});
