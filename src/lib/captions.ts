import type { TranscriptSegment } from "./types";

function stamp(seconds: number, comma: boolean): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${comma ? "," : "."}${pad(ms, 3)}`;
}

function line(segment: TranscriptSegment): string {
  const text = segment.text.trim();
  return segment.speaker ? `${segment.speaker}: ${text}` : text;
}

export function toSrt(segments: TranscriptSegment[]): string {
  return segments
    .filter((s) => s.text.trim())
    .map((s, index) => `${index + 1}\n${stamp(s.start, true)} --> ${stamp(s.end, true)}\n${line(s)}`)
    .join("\n\n") + "\n";
}

export function toVtt(segments: TranscriptSegment[]): string {
  const body = segments
    .filter((s) => s.text.trim())
    .map((s) => `${stamp(s.start, false)} --> ${stamp(s.end, false)}\n${line(s)}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}
