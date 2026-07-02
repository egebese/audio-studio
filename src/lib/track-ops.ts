import type { Clip, Track, TrackKind } from "./types";

export interface TrackClipState {
  tracks: Track[];
  clips: Clip[];
}

function ordered(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => a.order - b.order);
}

export function normalizeTrackOrder(tracks: Track[]): Track[] {
  return ordered(tracks).map((track, order) => ({ ...track, order }));
}

function applyTrackOrder(tracks: Track[]): Track[] {
  return tracks.map((track, order) => ({ ...track, order }));
}

function defaultTrackName(tracks: Track[], kind: TrackKind): string {
  const label = kind === "sfx" ? "SFX" : kind.charAt(0).toUpperCase() + kind.slice(1);
  const count = tracks.filter((track) => track.kind === kind).length + 1;
  return count === 1 ? label : `${label} ${count}`;
}

export function addTrack(
  tracks: Track[],
  input: { id: string; projectId: string; kind: TrackKind; insertAt?: number }
): Track[] {
  const insertAt = input.insertAt ?? tracks.length;
  const shifted = tracks.map((track) =>
    track.order >= insertAt ? { ...track, order: track.order + 1 } : track
  );
  return normalizeTrackOrder([
    ...shifted,
    {
      id: input.id,
      projectId: input.projectId,
      kind: input.kind,
      name: defaultTrackName(tracks, input.kind),
      gain: 1,
      muted: false,
      solo: false,
      order: insertAt
    }
  ]);
}

export function renameTrack(tracks: Track[], trackId: string, name: string): Track[] {
  const clean = name.trim();
  return tracks.map((track) => (track.id === trackId ? { ...track, name: clean || track.name } : track));
}

export function setTrackGain(tracks: Track[], trackId: string, gain: number): Track[] {
  const nextGain = Math.round(Math.max(0, Math.min(2, gain)) * 100) / 100;
  return tracks.map((track) => (track.id === trackId ? { ...track, gain: nextGain } : track));
}

export function toggleTrackMute(tracks: Track[], trackId: string): Track[] {
  return tracks.map((track) => (track.id === trackId ? { ...track, muted: !track.muted } : track));
}

export function toggleTrackSolo(tracks: Track[], trackId: string): Track[] {
  return tracks.map((track) => (track.id === trackId ? { ...track, solo: !track.solo } : track));
}

export function moveTrack(tracks: Track[], trackId: string, direction: -1 | 1): Track[] {
  const next = ordered(tracks);
  const index = next.findIndex((track) => track.id === trackId);
  const swapIndex = index + direction;
  if (index < 0 || swapIndex < 0 || swapIndex >= next.length) return normalizeTrackOrder(next);
  [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  return applyTrackOrder(next);
}

export function duplicateTrack(
  state: TrackClipState,
  trackId: string,
  ids: { trackId: string; clipId: () => string }
): TrackClipState {
  const source = state.tracks.find((track) => track.id === trackId);
  if (!source) return state;
  const insertAt = source.order + 1;
  const shiftedTracks = state.tracks.map((track) =>
    track.order >= insertAt ? { ...track, order: track.order + 1 } : track
  );
  const trackCopy: Track = {
    ...source,
    id: ids.trackId,
    name: `${source.name} Copy`,
    order: insertAt
  };
  const clipCopies = state.clips
    .filter((clip) => clip.trackId === trackId)
    .map((clip) => ({ ...clip, id: ids.clipId(), trackId: ids.trackId }));

  return {
    tracks: normalizeTrackOrder([...shiftedTracks, trackCopy]),
    clips: [...state.clips, ...clipCopies]
  };
}

export function deleteTrack(state: TrackClipState, trackId: string): TrackClipState {
  return {
    tracks: normalizeTrackOrder(state.tracks.filter((track) => track.id !== trackId)),
    clips: state.clips.filter((clip) => clip.trackId !== trackId)
  };
}

export function audibleTrackIds(tracks: Track[]): Set<string> {
  const soloTracks = tracks.filter((track) => track.solo);
  const audible = soloTracks.length > 0 ? soloTracks : tracks.filter((track) => !track.muted);
  return new Set(audible.map((track) => track.id));
}

export function isTrackAudible(track: Track, tracks: Track[]): boolean {
  return audibleTrackIds(tracks).has(track.id);
}
