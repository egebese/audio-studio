import type { DiarizationSegment, TranscriptSegment } from "./types";

export interface NormalizedTranscript {
  transcript?: string;
  transcriptSegments?: TranscriptSegment[];
  diarizationSegments?: DiarizationSegment[];
}

export function transcriptSpeakerKey(segment: Pick<TranscriptSegment, "speaker">): string {
  return segment.speaker?.trim() || "Speaker";
}

export function segmentsForSpeaker(
  segments: TranscriptSegment[],
  speaker: string
): TranscriptSegment[] {
  return segments.filter((segment) => transcriptSpeakerKey(segment) === speaker);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function num(value: unknown): number | undefined {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function timeRange(record: Record<string, unknown>): { start: number; end: number } | undefined {
  const directStart = num(record.start ?? record.start_time);
  const directEnd = num(record.end ?? record.end_time);
  if (directStart !== undefined && directEnd !== undefined) return { start: directStart, end: directEnd };

  const timestamp = record.timestamp ?? record.timestamps;
  if (Array.isArray(timestamp)) {
    const start = num(timestamp[0]);
    const end = num(timestamp[1]);
    if (start !== undefined && end !== undefined) return { start, end };
  }

  return undefined;
}

function speakerLabel(raw: unknown, index: number, labels: Map<string, string>): string {
  const key = String(raw ?? "").trim();
  if (!key) return `Speaker ${index + 1}`;
  const existing = labels.get(key);
  if (existing) return existing;
  const next = `Speaker ${labels.size + 1}`;
  labels.set(key, next);
  return next;
}

function overlap(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function speakerFor(
  segment: { start: number; end: number },
  diarizationSegments: DiarizationSegment[]
): string | undefined {
  const best = diarizationSegments
    .map((item) => ({ speaker: item.speaker, score: overlap(segment, item) }))
    .sort((a, b) => b.score - a.score)[0];
  return best?.score ? best.speaker : undefined;
}

export function normalizeWhisperTranscript(raw: unknown): NormalizedTranscript {
  const data = asRecord(raw);
  if (!data) return {};

  const transcript = typeof data.text === "string"
    ? data.text
    : typeof data.transcript === "string"
      ? data.transcript
      : undefined;

  const labels = new Map<string, string>();
  const diarizationSegments = Array.isArray(data.diarization_segments)
    ? data.diarization_segments.flatMap((item, index): DiarizationSegment[] => {
        const record = asRecord(item);
        if (!record) return [];
        const range = timeRange(record);
        if (!range || range.end <= range.start) return [];
        return [{
          id: `diar_${index}`,
          ...range,
          speaker: speakerLabel(record.speaker, index, labels)
        }];
      })
    : [];

  const transcriptSegments = Array.isArray(data.chunks)
    ? data.chunks.flatMap((item, index): TranscriptSegment[] => {
        const record = asRecord(item);
        if (!record) return [];
        const range = timeRange(record);
        const text = String(record.text ?? "").trim();
        if (!range || range.end <= range.start || !text) return [];
        return [{
          id: `seg_${index}`,
          ...range,
          text,
          speaker: record.speaker ? speakerLabel(record.speaker, index, labels) : speakerFor(range, diarizationSegments),
          confidence: num(record.confidence)
        }];
      })
    : [];

  return {
    transcript,
    transcriptSegments: transcriptSegments.length ? transcriptSegments : undefined,
    diarizationSegments: diarizationSegments.length ? diarizationSegments : undefined
  };
}

export function offsetTranscript(
  transcript: NormalizedTranscript,
  offset: number
): NormalizedTranscript {
  if (!offset) return transcript;
  return {
    ...transcript,
    transcriptSegments: transcript.transcriptSegments?.map((segment) => ({
      ...segment,
      start: segment.start + offset,
      end: segment.end + offset
    })),
    diarizationSegments: transcript.diarizationSegments?.map((segment) => ({
      ...segment,
      start: segment.start + offset,
      end: segment.end + offset
    }))
  };
}
