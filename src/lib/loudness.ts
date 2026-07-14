import type { TrackKind } from "@/lib/types";

// Loudness-based ducking shared by in-app Auto-duck and cinematic assembly.
// Level = 75th-percentile of 20ms-frame RMS; a bed's gain is set so it plays a fixed
// dB UNDER the voice (measured, not hand-guessed).

// dB a bed of each kind sits below the voice.
export const DUCK_DB: Record<Exclude<TrackKind, "voice">, number> = { music: 14, sfx: 16 };

// The "typical loud level" of a signal. Mean RMS underreads speech (its gaps drag the
// average down) vs. continuous music, so the 75th-percentile frame level compares fairly.
export function frameLevel(samples: Float32Array, sampleRate: number, pct = 0.75): number {
  const frame = Math.max(1, Math.round(0.02 * sampleRate));
  const levels: number[] = [];
  for (let i = 0; i < samples.length; i += frame) {
    const end = Math.min(samples.length, i + frame);
    let sum = 0;
    let n = 0;
    for (let j = i; j < end; j++) {
      sum += samples[j] * samples[j];
      n++;
    }
    if (n) {
      const rms = Math.sqrt(sum / n);
      if (rms > 0.003) levels.push(rms);
    }
  }
  if (!levels.length) return 0;
  levels.sort((a, b) => a - b);
  return levels[Math.min(levels.length - 1, Math.floor(pct * levels.length))];
}

export function median(values: number[]): number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

// Gain so `bedLevel` plays `offsetDb` under `voiceLevel`. By construction the bed then
// plays at voiceLevel·10^(-offsetDb/20). Returns 1 (no change) if either level is unknown.
export function duckGain(voiceLevel: number, bedLevel: number, offsetDb: number, cap = 1.4): number {
  if (!(bedLevel > 0) || !(voiceLevel > 0)) return 1;
  const gain = (voiceLevel / bedLevel) * Math.pow(10, -offsetDb / 20);
  return Math.round(Math.min(cap, Math.max(0, gain)) * 100) / 100;
}
