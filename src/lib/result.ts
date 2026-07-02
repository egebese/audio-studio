import type { ModelOutput } from "./types";
import { normalizeWhisperTranscript } from "./transcript";

function durationFrom(output: ReturnType<typeof normalizeWhisperTranscript>): number {
  const ends = [
    ...(output.transcriptSegments ?? []).map((segment) => segment.end),
    ...(output.diarizationSegments ?? []).map((segment) => segment.end)
  ];
  return Math.max(0, ...ends);
}

export function normalizeModelOutput(raw: unknown): ModelOutput[] {
  const data = (raw ?? {}) as Record<string, unknown>;
  const transcript = normalizeWhisperTranscript(raw);
  const candidates = [data.audio, data.output, data.audio_file, data.file, data];
  const outputs: ModelOutput[] = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    const url = record.url ?? record.audio_url ?? record.audio;
    if (typeof url !== "string") continue;
    const duration = typeof record.duration === "number" ? record.duration : 0;
    outputs.push({
      url,
      duration,
      contentType: typeof record.content_type === "string" ? record.content_type : undefined,
      transcript: transcript.transcript,
      transcriptSegments: transcript.transcriptSegments,
      diarizationSegments: transcript.diarizationSegments,
      prompt: typeof data.scene_prompt === "string" ? data.scene_prompt : undefined,
      raw
    });
  }

  if (Array.isArray(data.outputs)) {
    for (const item of data.outputs) outputs.push(...normalizeModelOutput(item));
  }

  if (!outputs.length && transcript.transcript) {
    outputs.push({
      duration: durationFrom(transcript),
      transcript: transcript.transcript,
      transcriptSegments: transcript.transcriptSegments,
      diarizationSegments: transcript.diarizationSegments,
      raw
    });
  }

  return outputs.length ? outputs : [];
}
