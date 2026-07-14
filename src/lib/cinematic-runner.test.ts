import { describe, it, expect } from "vitest";
import { runCinematic } from "./cinematic-runner";
import { specJobCount, validateCinematicSpec } from "./cinematic-spec";
import type { ModelOutput } from "./types";

const spec = validateCinematicSpec({
  name: "TEST",
  anchor: { prompt: 'The narrator (deep) narrates: "Hook."' },
  voice: [
    { model: "seed-tts", prompt: 'The narrator (voiced by @Audio1) narrates: "One."', clone: true },
    { model: "seed-scene", prompt: "[room] A (american accent) says: \"Two.\"" }
  ],
  score: { prompt: "epic", seconds: 30 },
  layers: [{ model: "mmaudio", name: "Ambience", duck: "ambience", place: "bed", prompt: "wind", seconds: 12 }],
  outro: { prompt: 'The narrator (voiced by @Audio1) narrates: "Reveal."' }
});

describe("runCinematic", () => {
  it("maps only mentioned cast voices into each Seed prompt and skips the internal anchor", async () => {
    const castSpec = validateCinematicSpec({
      name: "CAST",
      anchor: { prompt: "generated narrator" },
      voice: [
        {
          model: "seed-scene",
          prompt: '[A hall.] @Warlord says: "Stand." @Queen replies: "Never."'
        },
        {
          model: "seed-tts",
          prompt: '@Narrator says: "The hall falls silent."'
        },
        {
          model: "seed-tts",
          prompt: "A distant bell rings."
        }
      ],
      layers: [],
      outro: { prompt: '@Queen says: "This is over."' }
    });
    const calls: Array<{ modelId: string; input: Record<string, unknown> }> = [];
    const progress: Array<{ phase: string; done: number; total: number }> = [];
    let n = 0;
    const runJob = async (modelId: string, input: Record<string, unknown>): Promise<ModelOutput> => {
      calls.push({ modelId, input });
      if (modelId === "whisper-asr") {
        return { duration: 4, transcriptSegments: [{ id: "s", start: 0.2, end: 2, text: "words" }] };
      }
      return { url: `https://x/${modelId}-${n++}.wav`, duration: 4 };
    };
    const analyze = async () => ({ duration: 4, level: 0.03, start: 0.1, end: 2.2 });

    await runCinematic(castSpec, "cast_project", {
      cast: [
        { id: "q", name: "Queen", url: "https://q.wav", duration: 8 },
        { id: "w", name: "Warlord", url: "https://w.wav", duration: 9 },
        { id: "n", name: "Narrator", url: "https://n.wav", duration: 7 }
      ],
      runJob,
      analyze,
      onProgress: (value) => progress.push(value)
    });

    expect(calls.find((call) => call.input.prompt === "generated narrator")).toBeUndefined();
    expect(calls.find((call) => call.modelId === "seed-scene")).toMatchObject({
      input: {
        prompt: '[A hall.] @Audio1 says: "Stand." @Audio2 replies: "Never."',
        enhance: false,
        audio_urls: ["https://w.wav", "https://q.wav"]
      }
    });
    expect(calls.find((call) => call.input.prompt === '@Audio1 says: "The hall falls silent."')).toMatchObject({
      modelId: "seed-tts",
      input: {
        enhance: false,
        audio_urls: ["https://n.wav"]
      }
    });
    const uncastLine = calls.find((call) => call.input.prompt === "A distant bell rings.")!;
    expect(uncastLine).toMatchObject({
      modelId: "seed-tts",
      input: {
        enhance: false
      }
    });
    expect(uncastLine.input).not.toHaveProperty("audio_urls");
    expect(calls.find((call) => call.input.prompt === '@Audio1 says: "This is over."')).toMatchObject({
      modelId: "seed-tts",
      input: {
        enhance: false,
        audio_urls: ["https://q.wav"]
      }
    });
    expect(progress.at(-1)).toEqual({
      phase: "Assembling the mix",
      done: specJobCount(castSpec) - 1,
      total: specJobCount(castSpec) - 1
    });
  });

  it("runs the pipeline, clones the anchor into VO lines, and assembles a snapshot", async () => {
    const calls: Array<{ modelId: string; input: Record<string, unknown> }> = [];
    let n = 0;
    const runJob = async (modelId: string, input: Record<string, unknown>): Promise<ModelOutput> => {
      calls.push({ modelId, input });
      if (modelId === "whisper-asr") {
        return { duration: 6, transcriptSegments: [{ id: "s", start: 0.3, end: 4, text: "words" }] };
      }
      return { url: `https://x/${modelId}-${n++}.wav`, duration: 6 };
    };
    const analyze = async () => ({ duration: 6, level: 0.03, start: 0.2, end: 4.2 });

    const progress: Array<{ phase: string; done: number; total: number }> = [];
    const snap = await runCinematic(spec, "proj_x", { runJob, analyze, onProgress: (value) => progress.push(value) });

    // anchor first, VO lines carry the anchor url, scene (no clone/useAnchor) does not.
    expect(calls[0].modelId).toBe("seed-tts"); // anchor
    const anchorUrl = `https://x/seed-tts-0.wav`;
    const clonedVo = calls.find((c) => c.input.prompt === spec.voice[0].prompt)!;
    expect(clonedVo.input.audio_urls).toEqual([anchorUrl]);
    const scene = calls.find((c) => c.input.prompt === spec.voice[1].prompt)!;
    expect(scene.input.audio_urls).toBeUndefined();
    const reveal = calls.find((c) => c.input.prompt === spec.outro?.prompt)!;
    expect(reveal.input.audio_urls).toEqual([anchorUrl]); // the closing line is cloned too

    // whisper called once per VO + closing line (crops)
    expect(calls.filter((c) => c.modelId === "whisper-asr")).toHaveLength(3);

    // assembled snapshot: voice + score + closing + ambience tracks
    expect(snap.tracks.map((t) => t.name)).toEqual(["Voice", "Score", "Closing", "Ambience"]);
    expect(snap.project.id).toBe("proj_x");
    expect(progress.at(-1)).toEqual({
      phase: "Assembling the mix",
      done: specJobCount(spec),
      total: specJobCount(spec)
    });
  });

  it("stops when Whisper cropping is cancelled", async () => {
    const controller = new AbortController();
    const leanSpec = validateCinematicSpec({
      name: "Cancelled",
      voice: [{ model: "seed-tts", prompt: "A line." }],
      layers: []
    });
    const runJob = async (modelId: string): Promise<ModelOutput> => {
      if (modelId === "whisper-asr") {
        controller.abort();
        throw new Error("request cancelled");
      }
      return { url: "https://x/voice.wav", duration: 4 };
    };
    const analyze = async () => ({ duration: 4, level: 0.03, start: 0.1, end: 2.2 });

    await expect(
      runCinematic(leanSpec, "cancelled_project", { runJob, analyze, signal: controller.signal })
    ).rejects.toThrow("aborted");
  });

  it("stops before assembly when score analysis is cancelled", async () => {
    const controller = new AbortController();
    const scoreSpec = validateCinematicSpec({
      name: "Cancelled score",
      voice: [{ model: "seed-tts", prompt: "A line." }],
      score: { prompt: "A score.", seconds: 10 },
      layers: []
    });
    const runJob = async (modelId: string): Promise<ModelOutput> => {
      if (modelId === "whisper-asr") {
        return { duration: 2, transcriptSegments: [{ id: "s", start: 0.1, end: 1, text: "line" }] };
      }
      return { url: `https://x/${modelId}.wav`, duration: 4 };
    };
    const phases: string[] = [];
    const analyze = async (url: string) => {
      if (url.includes("stable-audio")) controller.abort();
      return { duration: 4, level: 0.03, start: 0.1, end: 2.2 };
    };

    await expect(
      runCinematic(scoreSpec, "cancelled_score", {
        runJob,
        analyze,
        signal: controller.signal,
        onProgress: ({ phase }) => phases.push(phase)
      })
    ).rejects.toThrow("aborted");
    expect(phases).not.toContain("Assembling the mix");
  });

  it("fails clearly when a voice job produces no audio URL", async () => {
    const leanSpec = validateCinematicSpec({
      name: "Missing voice",
      voice: [{ model: "seed-tts", prompt: "A line." }],
      layers: []
    });
    const runJob = async (modelId: string): Promise<ModelOutput> => {
      if (modelId === "whisper-asr") {
        return { duration: 2, transcriptSegments: [{ id: "s", start: 0.1, end: 1, text: "line" }] };
      }
      return { duration: 0 };
    };
    const analyze = async () => ({ duration: 2, level: 0.03, start: 0, end: 1.2 });

    await expect(runCinematic(leanSpec, "missing_voice", { runJob, analyze })).rejects.toThrow(
      "Voice line produced no audio"
    );
  });

  it.each([
    {
      name: "score",
      raw: {
        name: "Missing score",
        voice: [{ model: "seed-tts", prompt: "A line." }],
        score: { prompt: "Music", seconds: 10 },
        layers: []
      },
      missingPrompt: "Music",
      error: "Score produced no audio"
    },
    {
      name: "outro",
      raw: {
        name: "Missing outro",
        voice: [{ model: "seed-tts", prompt: "A line." }],
        layers: [],
        outro: { prompt: "Closing line." }
      },
      missingPrompt: "Closing line.",
      error: "Closing line produced no audio"
    }
  ])("fails clearly instead of omitting a requested $name", async ({ raw, missingPrompt, error }) => {
    const requestedSpec = validateCinematicSpec(raw);
    const runJob = async (modelId: string, input: Record<string, unknown>): Promise<ModelOutput> => {
      if (modelId === "whisper-asr") {
        return { duration: 2, transcriptSegments: [{ id: "s", start: 0.1, end: 1, text: "line" }] };
      }
      if (input.prompt === missingPrompt) return { duration: 0 };
      return { url: `https://x/${modelId}.wav`, duration: 4 };
    };
    const analyze = async () => ({ duration: 4, level: 0.03, start: 0.1, end: 2.2 });

    await expect(runCinematic(requestedSpec, "missing_requested_part", { runJob, analyze })).rejects.toThrow(error);
  });

  it("runs seed-extend for an extended segment and appends the continuation as a 2nd clip", async () => {
    const extSpec = validateCinematicSpec({
      name: "T",
      anchor: { prompt: "a" },
      voice: [{ model: "seed-tts", prompt: "narration", clone: true, extend: { seconds: 8, direction: "keep going" } }],
      score: { prompt: "s", seconds: 30 },
      layers: [],
      outro: { prompt: "reveal" }
    });
    const calls: string[] = [];
    let n = 0;
    const runJob = async (modelId: string): Promise<ModelOutput> => {
      calls.push(modelId);
      if (modelId === "whisper-asr") return { duration: 6, transcriptSegments: [{ id: "s", start: 0.3, end: 4, text: "w" }] };
      return { url: `u/${modelId}-${n++}.wav`, duration: 6 };
    };
    const analyze = async () => ({ duration: 6, level: 0.03, start: 0.2, end: 4.2 });
    const snap = await runCinematic(extSpec, "p", { runJob, analyze });

    expect(calls).toContain("seed-extend");
    const scene = snap.tracks.find((t) => t.name === "Voice")!;
    // base + extension = 2 clips on the voice track
    expect(snap.clips.filter((c) => c.trackId === scene.id)).toHaveLength(2);
  });
});
