// Silence detection for generated outputs. Pure math so it's unit-testable;
// audio-io.ts owns the fetch+decode wrapper. Clips are placed on the audible
// window (asset untouched) so trimmed silence can be pulled back with the
// clip handles.

export interface AudibleWindow {
  start: number;
  end: number;
  duration: number;
}

// Scans peak amplitude in ~10ms hops. Returns the audible window in seconds
// (padded so transients survive), or null when the whole buffer is silent.
export function detectAudibleWindow(
  channel: Float32Array | number[],
  sampleRate: number,
  opts: { threshold?: number; windowS?: number; padS?: number } = {}
): { start: number; end: number } | null {
  const threshold = opts.threshold ?? 0.003; // ≈ -50 dBFS
  const hop = Math.max(1, Math.round((opts.windowS ?? 0.01) * sampleRate));
  const pad = opts.padS ?? 0.05;
  let firstSample = -1;
  let lastSample = -1;

  for (let index = 0; index < channel.length; index += hop) {
    const end = Math.min(channel.length, index + hop);
    let peak = 0;
    for (let cursor = index; cursor < end; cursor += 1) {
      const value = Math.abs(channel[cursor]);
      if (value > peak) peak = value;
    }
    if (peak >= threshold) {
      if (firstSample < 0) firstSample = index;
      lastSample = end;
    }
  }

  if (firstSample < 0) return null;
  const duration = channel.length / sampleRate;
  return {
    start: Math.max(0, firstSample / sampleRate - pad),
    end: Math.min(duration, lastSample / sampleRate + pad)
  };
}

export interface TrimPlan {
  offset: number;
  duration: number;
  cut: number;
  silent: boolean;
}

// Decides how a new output clip should land given its audible window.
// undefined window = analysis unavailable → keep the full clip untouched.
export function trimPlan(
  window: AudibleWindow | null | undefined,
  fallbackDuration: number,
  minTrim = 0.3
): TrimPlan {
  if (window === undefined) return { offset: 0, duration: fallbackDuration, cut: 0, silent: false };
  if (window === null) return { offset: 0, duration: 0, cut: fallbackDuration, silent: true };
  const lead = window.start;
  const tail = window.duration - window.end;
  if (lead < minTrim && tail < minTrim) {
    return { offset: 0, duration: window.duration, cut: 0, silent: false };
  }
  const duration = Math.max(window.end - window.start, 0.1);
  return { offset: window.start, duration, cut: Math.max(0, window.duration - duration), silent: false };
}
