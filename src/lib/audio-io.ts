// Browser audio I/O helpers shared by the studio UI. fal storage keeps IndexedDB
// snapshots small (URLs instead of payloads); data URL is the offline fallback.

import { frameLevel } from "./loudness";
import { detectAudibleWindow, type AudibleWindow } from "./silence";

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function uploadToStorage(file: File | Blob, name?: string): Promise<string> {
  const form = new FormData();
  form.append("file", file, name ?? (file instanceof File ? file.name : "audio.wav"));
  const response = await fetch("/api/upload", { method: "POST", body: form });
  const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !data?.url) throw new Error(data?.error ?? `upload failed (${response.status})`);
  return data.url;
}

export async function storeBlob(blob: Blob, name: string): Promise<string> {
  try {
    return await uploadToStorage(blob, name);
  } catch {
    return blobToDataUrl(blob);
  }
}

// Decodes a remote/generated file and measures its audible window.
// undefined = analysis failed (CORS, codec) → caller must not trim.
export async function audibleWindow(url: string): Promise<AudibleWindow | null | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const bytes = await response.arrayBuffer();
    const offline = new OfflineAudioContext(1, 1, 44100);
    const decoded = await offline.decodeAudioData(bytes);
    const window = detectAudibleWindow(decoded.getChannelData(0), decoded.sampleRate);
    return window ? { ...window, duration: decoded.duration } : null;
  } catch {
    return undefined;
  }
}

// Decodes a file (WAV or MP3 — decodeAudioData handles both) and returns its loudness
// level (75th-pct frame RMS) for the ducking formula, or null on failure (CORS/codec).
export async function measureLevel(url: string): Promise<number | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const offline = new OfflineAudioContext(1, 1, 44100);
    const decoded = await offline.decodeAudioData(bytes);
    return frameLevel(decoded.getChannelData(0), decoded.sampleRate);
  } catch {
    return null;
  }
}

export interface ClipAnalysis {
  duration: number;
  level: number;
  start: number;
  end: number;
}

// One-decode analysis for the cinematic runner: full duration + loudness level + the
// audible window (for cropping/placement). null on decode failure.
export async function analyzeClip(url: string): Promise<ClipAnalysis | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const offline = new OfflineAudioContext(1, 1, 44100);
    const decoded = await offline.decodeAudioData(bytes);
    const channel = decoded.getChannelData(0);
    const win = detectAudibleWindow(channel, decoded.sampleRate);
    return {
      duration: decoded.duration,
      level: frameLevel(channel, decoded.sampleRate) || 0.1,
      start: win ? win.start : 0,
      end: win ? win.end : decoded.duration
    };
  } catch {
    return null;
  }
}

export function audioDuration(url: string, timeoutMs = 8000): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    let done = false;
    // Expired/blocked URLs can stall without firing error; time out so one bad
    // URL never hangs a Promise.all probe (e.g. the preview importer).
    const finish = (value: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(0), timeoutMs);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}
