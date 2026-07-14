import { describe, expect, it } from "vitest";
import {
  addTrack,
  audibleTrackIds,
  deleteTrack,
  duplicateTrack,
  moveTrack,
  renameTrack,
  setTrackGain,
  playbackClipVolume,
  toggleTrackMute,
  toggleTrackSolo
} from "./track-ops";
import type { Clip, Track } from "./types";

const tracks: Track[] = [
  { id: "voice", projectId: "p", kind: "voice", name: "Voice", gain: 1, muted: false, solo: false, order: 0 },
  { id: "music", projectId: "p", kind: "music", name: "Music", gain: 0.8, muted: false, solo: false, order: 1 }
];

const clips: Clip[] = [
  { id: "clip1", trackId: "voice", assetId: "asset1", start: 0, duration: 4, offset: 0, gain: 1, fadeIn: 0, fadeOut: 0 },
  { id: "clip2", trackId: "music", assetId: "asset2", start: 1, duration: 5, offset: 0, gain: 1, fadeIn: 0, fadeOut: 0 }
];

describe("track operations", () => {
  it("adds, renames, gains, mutes, solos, and reorders tracks", () => {
    const added = addTrack(tracks, { id: "sfx", projectId: "p", kind: "sfx" });
    expect(added.map((track) => track.name)).toEqual(["Voice", "Music", "SFX"]);

    expect(renameTrack(added, "sfx", "Impacts").find((track) => track.id === "sfx")?.name).toBe("Impacts");
    expect(setTrackGain(added, "music", 2.5).find((track) => track.id === "music")?.gain).toBe(2);
    expect(toggleTrackMute(added, "music").find((track) => track.id === "music")?.muted).toBe(true);
    expect(toggleTrackSolo(added, "voice").find((track) => track.id === "voice")?.solo).toBe(true);
    expect(moveTrack(added, "sfx", -1).map((track) => track.id)).toEqual(["voice", "sfx", "music"]);
  });

  it("uses solo precedence over mute", () => {
    const mixed = [
      { ...tracks[0], muted: true, solo: true },
      { ...tracks[1], muted: false, solo: false }
    ];
    expect([...audibleTrackIds(mixed)]).toEqual(["voice"]);
  });

  it("deletes track clips without deleting shared assets", () => {
    const next = deleteTrack({ tracks, clips }, "voice");
    expect(next.tracks.map((track) => track.id)).toEqual(["music"]);
    expect(next.clips.map((clip) => clip.id)).toEqual(["clip2"]);
    expect(next.clips[0].assetId).toBe("asset2");
  });

  it("duplicates track settings and clip instances with shared assets", () => {
    let count = 0;
    const next = duplicateTrack({ tracks, clips }, "voice", {
      trackId: "voice_copy",
      clipId: () => `copy_${count++}`
    });

    expect(next.tracks.map((track) => track.id)).toEqual(["voice", "voice_copy", "music"]);
    expect(next.clips.find((clip) => clip.id === "copy_0")).toMatchObject({
      trackId: "voice_copy",
      assetId: "asset1"
    });
  });
});

describe("playbackClipVolume", () => {
  const ref = { trackId: "music", gain: 0.5, start: 0, end: 10, fadeIn: 0, fadeOut: 0 };

  it("multiplies clip and track gain for audible tracks", () => {
    expect(playbackClipVolume(ref, tracks, 5)).toBeCloseTo(0.5 * 0.8);
  });

  it("returns 0 when the track is muted or another track is soloed", () => {
    const muted = toggleTrackMute(tracks, "music");
    expect(playbackClipVolume(ref, muted, 5)).toBe(0);
    const soloed = toggleTrackSolo(tracks, "voice");
    expect(playbackClipVolume(ref, soloed, 5)).toBe(0);
    // unmuting/unsoloing restores mid-playback
    expect(playbackClipVolume(ref, toggleTrackSolo(soloed, "voice"), 5)).toBeCloseTo(0.4);
  });

  it("applies fade envelopes at the clip edges", () => {
    const faded = { ...ref, trackId: "voice", gain: 1, fadeIn: 2, fadeOut: 2 };
    expect(playbackClipVolume(faded, tracks, 1)).toBeCloseTo(0.5); // halfway into fade-in
    expect(playbackClipVolume(faded, tracks, 9)).toBeCloseTo(0.5); // halfway into fade-out
    expect(playbackClipVolume(faded, tracks, 5)).toBe(1);
  });
});
