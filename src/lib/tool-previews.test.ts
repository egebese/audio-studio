import { describe, expect, it } from "vitest";
import { buildPreviewSnapshot, previewMediaUrls, type ToolPreviewEntry } from "./tool-previews";

const durations = { "https://a/src.wav": 6, "https://a/out.wav": 4, "https://a/voice.wav": 5 };

function entry(overrides: Partial<ToolPreviewEntry> = {}): ToolPreviewEntry {
  return {
    toolId: "seed-restyle",
    label: "Restyle",
    status: "done",
    source: { url: "https://a/src.wav", name: "Speech" },
    output: { url: "https://a/out.wav" },
    ...overrides
  };
}

describe("buildPreviewSnapshot", () => {
  it("lays source and result on separate tracks with probed durations", () => {
    const snap = buildPreviewSnapshot(entry(), durations)!;
    expect(snap.project.id).toBe("preview_seed-restyle");
    expect(snap.tracks.map((t) => t.name)).toEqual(["Source", "Result"]);
    expect(snap.clips).toHaveLength(2);
    expect(snap.clips[0]).toMatchObject({ start: 0, duration: 6 });
    expect(snap.clips[1]).toMatchObject({ start: 0, duration: 4 });
    expect(snap.assets[1].derivedFrom?.modelId).toBe("seed-restyle");
  });

  it("places the extend result after the source", () => {
    const snap = buildPreviewSnapshot(entry({ toolId: "seed-extend", label: "Extend" }), durations)!;
    expect(snap.clips[1].start).toBe(6);
  });

  it("adds a muted voice-ref track when a voice target exists", () => {
    const snap = buildPreviewSnapshot(entry({ voice: { url: "https://a/voice.wav", name: "Target" } }), durations)!;
    expect(snap.tracks.map((t) => t.name)).toEqual(["Source", "Voice ref", "Result"]);
    expect(snap.tracks[1].muted).toBe(true);
  });

  it("attaches url-less whisper output as transcript on the source asset", () => {
    const snap = buildPreviewSnapshot(
      entry({
        toolId: "whisper-asr",
        label: "Transcribe",
        output: { transcript: "hello", transcriptSegments: [{ id: "s1", start: 0, end: 1, text: "hello" }] }
      }),
      durations
    )!;
    expect(snap.assets).toHaveLength(1);
    expect(snap.assets[0].transcript).toBe("hello");
    expect(snap.assets[0].transcriptSegments).toHaveLength(1);
    expect(snap.tracks.map((t) => t.name)).toEqual(["Source"]);
  });

  it("skips error entries and falls back to 8s when duration is unknown", () => {
    expect(buildPreviewSnapshot(entry({ status: "error", error: "boom" }), durations)).toBeUndefined();
    const snap = buildPreviewSnapshot(entry({ output: { url: "https://a/unknown.wav" } }), durations)!;
    expect(snap.clips[1].duration).toBe(8);
  });
});

describe("previewMediaUrls", () => {
  it("collects unique urls across entries", () => {
    const urls = previewMediaUrls({
      createdAt: "x",
      entries: [entry(), entry({ toolId: "seed-dub", voice: { url: "https://a/voice.wav" } })]
    });
    expect(urls.sort()).toEqual(["https://a/out.wav", "https://a/src.wav", "https://a/voice.wav"]);
  });
});
