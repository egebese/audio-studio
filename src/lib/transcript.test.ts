import { describe, expect, it } from "vitest";
import { normalizeWhisperTranscript, offsetTranscript, segmentsForSpeaker } from "./transcript";

describe("Whisper transcript normalization", () => {
  it("merges diarized speakers onto timestamp chunks", () => {
    const result = normalizeWhisperTranscript({
      text: "hello there welcome back",
      chunks: [
        { text: "hello there", timestamp: [0, 1.2] },
        { text: "welcome back", timestamp: [1.2, 2.4] }
      ],
      diarization_segments: [
        { speaker: "SPEAKER_00", start: 0, end: 1.3 },
        { speaker: "SPEAKER_01", start: 1.3, end: 2.4 }
      ]
    });

    expect(result.transcript).toBe("hello there welcome back");
    expect(result.transcriptSegments).toMatchObject([
      { start: 0, end: 1.2, text: "hello there", speaker: "Speaker 1" },
      { start: 1.2, end: 2.4, text: "welcome back", speaker: "Speaker 2" }
    ]);
  });

  it("offsets transcript ranges back into source-asset seconds", () => {
    const result = offsetTranscript(
      {
        transcript: "clip",
        transcriptSegments: [{ id: "seg", start: 0, end: 2, text: "clip" }],
        diarizationSegments: [{ id: "diar", start: 0, end: 2, speaker: "Speaker 1" }]
      },
      4
    );

    expect(result.transcriptSegments?.[0]).toMatchObject({ start: 4, end: 6 });
    expect(result.diarizationSegments?.[0]).toMatchObject({ start: 4, end: 6 });
  });

  it("filters visible transcript blocks by speaker", () => {
    expect(
      segmentsForSpeaker(
        [
          { id: "a", start: 0, end: 1, text: "one", speaker: "Speaker 1" },
          { id: "b", start: 1, end: 2, text: "two", speaker: "Speaker 2" }
        ],
        "Speaker 1"
      ).map((segment) => segment.id)
    ).toEqual(["a"]);
  });
});
