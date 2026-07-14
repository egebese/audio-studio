"use client";

import * as React from "react";
import { ClipWave } from "@/components/clip-wave";
import { ContextMenuView, type MenuState } from "@/components/context-menu-view";
import { formatTime, snapSecond } from "@/lib/studio-helpers";
import type { TimelineSelection } from "@/lib/studio-types";
import type { Asset, Clip, Track, TrackKind } from "@/lib/types";

const TRACK_KINDS: TrackKind[] = ["voice", "music", "sfx"];
// Track-label gutter width (px); lane x=0 starts after it (matches use-timeline-zoom).
const LANE_GUTTER = 176;

export function TimelineView({
  tracksRef,
  rulerTicksRef,
  tracks,
  clips,
  assets,
  pxPerSecond,
  playhead,
  rulerTicks,
  tickInterval,
  compactTracks,
  addTrackMenuOpen,
  renamingTrackId,
  dragOver,
  timelineSelection,
  selectedClipId,
  menu,
  hasClips,
  onToggleAddTrackMenu,
  onAddTrack,
  onToggleCompact,
  onAutoDuck,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onFocusGenerate,
  onRenameTrack,
  onStartRenameTrack,
  onStopRenameTrack,
  onClearSelection,
  onToggleMute,
  onToggleSolo,
  onMoveTrack,
  onSetTrackGain,
  onTrackMenu,
  onTrackMenuButton,
  onLaneMenu,
  onSetDragOver,
  onDropAsset,
  onBeginRegionSelect,
  onSelectClip,
  onClipMenu,
  onBeginClipEdit,
  onCloseMenu,
  onSeek
}: {
  tracksRef: React.RefObject<HTMLDivElement>;
  rulerTicksRef: React.RefObject<HTMLDivElement>;
  tracks: Track[];
  clips: Clip[];
  assets: Asset[];
  pxPerSecond: number;
  playhead: number;
  rulerTicks: number[];
  tickInterval: number;
  compactTracks: boolean;
  addTrackMenuOpen: boolean;
  renamingTrackId: string;
  dragOver: { trackId: string; seconds: number } | null;
  timelineSelection: TimelineSelection | null;
  selectedClipId: string;
  menu: MenuState | null;
  hasClips: boolean;
  onToggleAddTrackMenu: () => void;
  onAddTrack: (kind: TrackKind) => void;
  onToggleCompact: () => void;
  onAutoDuck: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onFocusGenerate: () => void;
  onRenameTrack: (id: string, name: string) => void;
  onStartRenameTrack: (id: string) => void;
  onStopRenameTrack: () => void;
  onClearSelection: () => void;
  onToggleMute: (id: string) => void;
  onToggleSolo: (id: string) => void;
  onMoveTrack: (id: string, direction: 1 | -1) => void;
  onSetTrackGain: (id: string, gain: number) => void;
  onTrackMenu: (event: React.MouseEvent, track: Track) => void;
  onTrackMenuButton: (track: Track, rect: DOMRect) => void;
  onLaneMenu: (event: React.MouseEvent, trackId: string, seconds: number) => void;
  onSetDragOver: (value: { trackId: string; seconds: number } | null) => void;
  onDropAsset: (assetId: string, trackId: string, seconds: number) => void;
  onBeginRegionSelect: (event: React.PointerEvent<HTMLElement>, trackId: string) => void;
  onSelectClip: (clipId: string, assetId: string) => void;
  onClipMenu: (event: React.MouseEvent, clip: Clip) => void;
  onBeginClipEdit: (
    event: React.PointerEvent<HTMLElement>,
    clip: Clip,
    asset: Asset | undefined,
    mode: "move" | "trim-start" | "trim-end"
  ) => void;
  onCloseMenu: () => void;
  onSeek: (seconds: number) => void;
}) {
  const laneSeconds = (event: React.DragEvent<HTMLElement>, lane: HTMLElement): number => {
    const rect = lane.getBoundingClientRect();
    return snapSecond((event.clientX - rect.left + lane.scrollLeft) / pxPerSecond);
  };

  return (
    <section className="timeline">
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-title">
          <span className="label">Timeline Tracks</span>
          <strong>{tracks.length}</strong>
        </div>
        <div className="track-add">
          <button
            className="button compact"
            type="button"
            aria-expanded={addTrackMenuOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleAddTrackMenu();
            }}
          >
            + Track
          </button>
          {addTrackMenuOpen ? (
            <div className="track-add-menu" onClick={(event) => event.stopPropagation()}>
              {TRACK_KINDS.map((kind) => (
                <button key={kind} type="button" onClick={() => onAddTrack(kind)}>
                  {kind.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          className={`button compact ${compactTracks ? "active" : ""}`}
          type="button"
          aria-pressed={compactTracks}
          title="Toggle compact track height"
          onClick={onToggleCompact}
        >
          Compact
        </button>
        <button
          className="button compact"
          type="button"
          title="Level music & SFX to sit under the voice"
          disabled={!hasClips}
          onClick={onAutoDuck}
        >
          Auto-duck
        </button>
        <div className="zoom-controls">
          <button
            className="button compact"
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            disabled={pxPerSecond <= 4}
            onClick={onZoomOut}
          >
            -
          </button>
          <button
            className="button compact"
            type="button"
            title="Zoom in"
            aria-label="Zoom in"
            disabled={pxPerSecond >= 200}
            onClick={onZoomIn}
          >
            +
          </button>
          <button
            className="button compact"
            type="button"
            title="Fit timeline to view"
            disabled={!hasClips}
            onClick={onZoomFit}
          >
            Fit
          </button>
        </div>
      </div>
      <div
        className="ruler"
        title="Click to move the playhead"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const seconds =
            (event.clientX - rect.left - LANE_GUTTER + (tracksRef.current?.scrollLeft ?? 0)) / pxPerSecond;
          if (seconds >= 0) onSeek(snapSecond(seconds));
        }}
      >
        <div className="ruler-ticks" ref={rulerTicksRef}>
          {rulerTicks.map((tick) => (
            <span className="ruler-tick" key={tick} style={{ left: tick * pxPerSecond }}>
              {formatTime(tick)}
            </span>
          ))}
        </div>
      </div>
      <div
        className={`tracks ${compactTracks ? "compact" : ""}`}
        ref={tracksRef}
        style={{ "--grid": `${tickInterval * pxPerSecond}px` } as React.CSSProperties}
        onScroll={(event) => {
          if (rulerTicksRef.current) {
            rulerTicksRef.current.style.transform = `translateX(-${event.currentTarget.scrollLeft}px)`;
          }
        }}
      >
        {!hasClips ? (
          <div className="tracks-empty">
            <button className="button ghost" type="button" onClick={onFocusGenerate}>
              ✦ Compose a piece — or drop audio on a lane
            </button>
          </div>
        ) : null}
        {tracks.map((track, index) => (
          <div className="track" key={track.id}>
            <div
              className={`track-label ${track.muted ? "muted-track" : ""} ${track.solo ? "solo-track" : ""}`}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onTrackMenu(event, track);
              }}
            >
              <div className="track-head">
                <span className="track-index">{track.kind === "sfx" ? "S" : track.kind.charAt(0).toUpperCase()}{index + 1}</span>
                {renamingTrackId === track.id ? (
                  <input
                    className="track-name-input"
                    aria-label={`Rename ${track.name}`}
                    value={track.name}
                    autoFocus
                    onChange={(event) => onRenameTrack(track.id, event.target.value)}
                    onBlur={onStopRenameTrack}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "Escape") onStopRenameTrack();
                    }}
                  />
                ) : (
                  <button
                    className="track-name-button"
                    type="button"
                    onDoubleClick={() => onStartRenameTrack(track.id)}
                    onClick={onClearSelection}
                    title="Double-click to rename"
                  >
                    {track.name}
                  </button>
                )}
                <button
                  className="track-menu-button"
                  type="button"
                  aria-label={`Open ${track.name} track menu`}
                  title="Track menu: rename, clear, delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    onTrackMenuButton(track, event.currentTarget.getBoundingClientRect());
                  }}
                >
                  ...
                </button>
              </div>
              <div className="track-controls">
                <button
                  className={`track-toggle ${track.muted ? "active" : ""}`}
                  type="button"
                  aria-label={`Mute ${track.name}`}
                  title={`Mute ${track.name}`}
                  aria-pressed={track.muted}
                  onClick={() => onToggleMute(track.id)}
                >
                  M
                </button>
                <button
                  className={`track-toggle ${track.solo ? "active" : ""}`}
                  type="button"
                  aria-label={`Solo ${track.name}`}
                  title={`Solo ${track.name}`}
                  aria-pressed={track.solo}
                  onClick={() => onToggleSolo(track.id)}
                >
                  S
                </button>
                <button
                  className="track-small"
                  type="button"
                  aria-label={`Move ${track.name} up`}
                  disabled={index === 0}
                  onClick={() => onMoveTrack(track.id, -1)}
                >
                  ↑
                </button>
                <button
                  className="track-small"
                  type="button"
                  aria-label={`Move ${track.name} down`}
                  disabled={index === tracks.length - 1}
                  onClick={() => onMoveTrack(track.id, 1)}
                >
                  ↓
                </button>
              </div>
              <label className="track-level">
                <span>{track.gain.toFixed(2)}</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.01}
                  value={track.gain}
                  aria-label={`${track.name} level`}
                  onChange={(event) => onSetTrackGain(track.id, Number(event.target.value))}
                />
              </label>
            </div>
            <div
              className={`lane ${dragOver?.trackId === track.id ? "drag-over" : ""}`}
              onPointerDown={(event) => onBeginRegionSelect(event, track.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                const seconds = snapSecond((event.clientX - rect.left + event.currentTarget.scrollLeft) / pxPerSecond);
                onLaneMenu(event, track.id, seconds);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                const seconds = laneSeconds(event, event.currentTarget);
                onSetDragOver(
                  dragOver && dragOver.trackId === track.id && Math.abs(dragOver.seconds - seconds) < 0.05
                    ? dragOver
                    : { trackId: track.id, seconds }
                );
              }}
              onDragLeave={() => onSetDragOver(null)}
              onDrop={(event) => {
                onSetDragOver(null);
                onDropAsset(event.dataTransfer.getData("text/plain"), track.id, laneSeconds(event, event.currentTarget));
              }}
            >
              {dragOver?.trackId === track.id ? (
                <span className="drop-marker" style={{ left: dragOver.seconds * pxPerSecond }} aria-hidden="true" />
              ) : null}
              <span className="playhead" style={{ left: playhead * pxPerSecond }} aria-hidden="true" />
              {timelineSelection?.trackId === track.id ? (
                <span
                  className="region-selection"
                  style={{
                    left: timelineSelection.start * pxPerSecond,
                    width: Math.max((timelineSelection.end - timelineSelection.start) * pxPerSecond, 2)
                  }}
                  aria-hidden="true"
                />
              ) : null}
              {clips
                .filter((clip) => clip.trackId === track.id)
                .map((clip) => {
                  const asset = assets.find((item) => item.id === clip.assetId);
                  return (
                    <button
                      type="button"
                      className={`clip ${clip.id === selectedClipId ? "selected" : ""}`}
                      key={clip.id}
                      style={{ left: clip.start * pxPerSecond, width: Math.max(clip.duration * pxPerSecond, 32) }}
                      onPointerDown={(event) => onBeginClipEdit(event, clip, asset, "move")}
                      onClick={() => onSelectClip(clip.id, clip.assetId)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectClip(clip.id, clip.assetId);
                        onClipMenu(event, clip);
                      }}
                    >
                      <span
                        className="clip-handle left"
                        onPointerDown={(event) => onBeginClipEdit(event, clip, asset, "trim-start")}
                        aria-hidden="true"
                      />
                      <span className="clip-name">{asset?.name ?? "Missing asset"}</span>
                      <ClipWave clip={clip} asset={asset} />
                      <span
                        className="clip-handle right"
                        onPointerDown={(event) => onBeginClipEdit(event, clip, asset, "trim-end")}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      {menu ? <ContextMenuView menu={menu} onClose={onCloseMenu} /> : null}
    </section>
  );
}
