import { describe, expect, it } from "vitest";
import { toSrt, toVtt } from "./captions";
import type { TranscriptSegment } from "./types";

const segments: TranscriptSegment[] = [
  { id: "1", start: 1, end: 3.5, text: "Hello there.", speaker: "Speaker 1" },
  { id: "2", start: 3.5, end: 6, text: "  General Kenobi.  ", speaker: "Speaker 2" },
  { id: "3", start: 6, end: 6, text: "   ", speaker: "Speaker 1" }
];

describe("captions", () => {
  it("renders SRT with numbered cues, comma millis, and speaker labels", () => {
    const srt = toSrt(segments);
    expect(srt).toContain("1\n00:00:01,000 --> 00:00:03,500\nSpeaker 1: Hello there.");
    expect(srt).toContain("2\n00:00:03,500 --> 00:00:06,000\nSpeaker 2: General Kenobi.");
    expect(srt).not.toContain("00:00:06,000 --> 00:00:06,000"); // empty cue dropped
  });

  it("renders VTT with the header and dotted millis", () => {
    const vtt = toVtt(segments);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:03.500\nSpeaker 1: Hello there.");
  });
});
