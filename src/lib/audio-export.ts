"use client";

import type { Asset, Clip, Track } from "./types";
import { isTrackAudible } from "./track-ops";

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(2, buffer.numberOfChannels);
  const length = buffer.length * channels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, length, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export async function renderTimelineToWav(input: {
  assets: Asset[];
  clips: Clip[];
  tracks: Track[];
  sampleRate: number;
}): Promise<Blob> {
  const duration = Math.max(1, ...input.clips.map((clip) => clip.start + clip.duration));
  const offline = new OfflineAudioContext(2, Math.ceil(duration * input.sampleRate), input.sampleRate);
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const trackById = new Map(input.tracks.map((track) => [track.id, track]));

  await Promise.all(
    input.clips.map(async (clip) => {
      const asset = assetById.get(clip.assetId);
      const track = trackById.get(clip.trackId);
      if (!asset || !track || asset.kind !== "audio" || !isTrackAudible(track, input.tracks)) return;
      const res = await fetch(asset.url);
      const data = await res.arrayBuffer();
      const decoded = await offline.decodeAudioData(data.slice(0));
      const source = offline.createBufferSource();
      const gain = offline.createGain();
      source.buffer = decoded;
      const base = clip.gain * track.gain;
      const playable = Math.min(clip.duration, decoded.duration - clip.offset);
      const fadeIn = Math.min(Math.max(0, clip.fadeIn), playable / 2);
      const fadeOut = Math.min(Math.max(0, clip.fadeOut), playable / 2);
      gain.gain.setValueAtTime(fadeIn > 0 ? 0 : base, clip.start);
      if (fadeIn > 0) gain.gain.linearRampToValueAtTime(base, clip.start + fadeIn);
      if (fadeOut > 0) {
        gain.gain.setValueAtTime(base, clip.start + Math.max(fadeIn, playable - fadeOut));
        gain.gain.linearRampToValueAtTime(0, clip.start + playable);
      }
      source.connect(gain).connect(offline.destination);
      source.start(clip.start, clip.offset, playable);
    })
  );

  return encodeWav(await offline.startRendering());
}

export async function renderClipToWav(input: {
  asset: Asset;
  clip: Clip;
  sampleRate: number;
}): Promise<Blob> {
  const offline = new OfflineAudioContext(2, Math.ceil(Math.max(1, input.clip.duration) * input.sampleRate), input.sampleRate);
  const res = await fetch(input.asset.url);
  const data = await res.arrayBuffer();
  const decoded = await offline.decodeAudioData(data.slice(0));
  const source = offline.createBufferSource();
  const gain = offline.createGain();
  source.buffer = decoded;
  gain.gain.value = input.clip.gain;
  source.connect(gain).connect(offline.destination);
  const playable = Math.max(0, Math.min(input.clip.duration, decoded.duration - input.clip.offset));
  if (playable > 0) source.start(0, input.clip.offset, playable);
  return encodeWav(await offline.startRendering());
}
