"use client";

import * as React from "react";
import { IconPause, IconPlay, IconSkipStart, IconStop } from "@/components/transport-icons";
import { formatTime } from "@/lib/studio-helpers";
import type { TransportStatus } from "@/lib/studio-types";

export function StudioTransport({
  playhead,
  totalDuration,
  transportStatus,
  clipCount,
  exporting,
  sampleRate,
  onSeek,
  onPlay,
  onPause,
  onStop,
  onExport,
  onReset,
  onSampleRate
}: {
  playhead: number;
  totalDuration: number;
  transportStatus: TransportStatus;
  clipCount: number;
  exporting: boolean;
  sampleRate: number;
  onSeek: (seconds: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onExport: () => void;
  onReset: () => void;
  onSampleRate: (rate: number) => void;
}) {
  return (
    <footer className="transport">
      <div className="transport-readout">
        <div className="hero-time">{formatTime(playhead)}</div>
        <div className="label">Playhead / {formatTime(totalDuration)}</div>
      </div>
      <div className="transport-controls" aria-label="Timeline transport controls">
        <button
          className="transport-button"
          type="button"
          title="Skip to start"
          aria-label="Skip to start"
          onClick={() => onSeek(0)}
        >
          <IconSkipStart />
        </button>
        <button
          className="transport-button primary"
          type="button"
          title={transportStatus === "playing" ? "Pause" : "Play"}
          aria-label={transportStatus === "playing" ? "Pause" : "Play"}
          disabled={clipCount === 0}
          onClick={() => (transportStatus === "playing" ? onPause() : onPlay())}
        >
          {transportStatus === "playing" ? <IconPause /> : <IconPlay />}
        </button>
        <button className="transport-button" type="button" title="Stop" aria-label="Stop" onClick={onStop}>
          <IconStop />
        </button>
      </div>
      <input
        className="scrub"
        type="range"
        min={0}
        max={Math.max(totalDuration, 1)}
        step={0.01}
        value={Math.min(playhead, Math.max(totalDuration, 1))}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="Timeline scrubber"
      />
      <div className="meter" aria-hidden="true">
        {Array.from({ length: 16 }).map((_, index) => (
          <span key={index} className={index < Math.min(16, clipCount * 3) ? "on" : ""} />
        ))}
      </div>
      <button className="button" type="button" disabled={clipCount === 0 || exporting} onClick={onExport}>
        {exporting ? "Exporting..." : "Export WAV"}
      </button>
      <button
        className="button ghost"
        type="button"
        title="Delete all tracks, clips, and assets"
        onClick={onReset}
      >
        Reset local
      </button>
      <span className="status">{transportStatus.toUpperCase()}</span>
      <select
        className="select rate-select"
        aria-label="Project sample rate"
        title="Project sample rate (applies to export)"
        value={sampleRate}
        onChange={(event) => onSampleRate(Number(event.target.value))}
      >
        <option value={44100}>44.1KHZ</option>
        <option value={48000}>48KHZ</option>
      </select>
      <span className="status rate-format">WAV</span>
    </footer>
  );
}
