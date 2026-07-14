"use client";

import * as React from "react";
import {
  AudioPlayerButton,
  AudioPlayerDuration,
  AudioPlayerProgress,
  AudioPlayerTime
} from "@/components/ui/audio-player";
import { formatTime } from "@/lib/studio-helpers";
import { transcriptSpeakerKey } from "@/lib/transcript";
import type { TimelineSelection } from "@/lib/studio-types";
import type { Asset, Clip, Region, Track, TranscriptSegment } from "@/lib/types";

export function InspectorPanel({
  inspectorRef,
  selectedClip,
  selectedClipAsset,
  selectedAsset,
  selectedClipTranscript,
  timelineSelection,
  timelineSelectionHasClip,
  whisperBlockedForSelectedClip,
  canTranscribeSelectedClip,
  tracks,
  region,
  onSaveAsset,
  onSaveVoiceSelection,
  onTranscribe,
  onCutGap,
  onRegionModel,
  onDub,
  onPatchClip,
  onRegionChange,
  onEngagePlayer,
  onAddToTimeline,
  onSaveVoiceAsset,
  onExportCaptions,
  onSplitBySpeaker,
  onPlaySpeaker,
  onSelectSegment
}: {
  inspectorRef: React.Ref<HTMLDivElement>;
  selectedClip?: Clip;
  selectedClipAsset?: Asset;
  selectedAsset?: Asset;
  selectedClipTranscript: TranscriptSegment[];
  timelineSelection: TimelineSelection | null;
  timelineSelectionHasClip: boolean;
  whisperBlockedForSelectedClip: boolean;
  canTranscribeSelectedClip: boolean;
  tracks: Track[];
  region: Region;
  onSaveAsset: () => void;
  onSaveVoiceSelection: () => void;
  onTranscribe: () => void;
  onCutGap: () => void;
  onRegionModel: (modelId: string) => void;
  onDub: () => void;
  onPatchClip: (clipId: string, updater: (clip: Clip) => Clip) => void;
  onRegionChange: React.Dispatch<React.SetStateAction<Region>>;
  onEngagePlayer: () => void;
  onAddToTimeline: (asset: Asset) => void;
  onSaveVoiceAsset: (asset: Asset) => void;
  onExportCaptions: (format: "srt" | "vtt") => void;
  onSplitBySpeaker: () => void;
  onPlaySpeaker: (speaker: string) => void;
  onSelectSegment: (segment: TranscriptSegment) => void;
}) {
  return (
    <div className="rail-section inspector-region" ref={inspectorRef}>
      <section className="section">
        <div className="section-title">
          <h2>Inspector</h2>
          <span className="pill">{selectedClip ? "clip" : selectedAsset ? "asset" : "none"}</span>
        </div>
        {timelineSelection ? (
          <div className="inspector-card">
            <strong>Selected region</strong>
            <p className="fine">
              Track {tracks.find((track) => track.id === timelineSelection.trackId)?.name ?? "Unknown"} / {timelineSelection.start.toFixed(2)}-{timelineSelection.end.toFixed(2)}s
            </p>
            {!timelineSelectionHasClip ? <p className="fine">[WARN] Select across a clip to use source models.</p> : null}
            <div className="button-row">
              <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={onSaveAsset}>
                Save asset
              </button>
              <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={onSaveVoiceSelection}>
                Save voice
              </button>
              <button className="button compact" type="button" disabled={!timelineSelectionHasClip || whisperBlockedForSelectedClip} onClick={onTranscribe}>
                Transcribe
              </button>
              <button className="button compact danger" type="button" disabled={!timelineSelectionHasClip} onClick={onCutGap}>
                Cut gap
              </button>
            </div>
            <div className="button-row transform-row">
              <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={() => onRegionModel("seed-inpaint")}>
                Inpaint
              </button>
              <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={() => onRegionModel("seed-restyle")}>
                Restyle
              </button>
              <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={() => onRegionModel("seed-voice-changer")}>
                Voice-change
              </button>
              <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={() => onRegionModel("seed-extend")}>
                Extend
              </button>
              <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={onDub}>
                Dub
              </button>
            </div>
          </div>
        ) : null}

        {selectedClip && selectedClipAsset ? (
          <div className="inspector-card">
            <strong>{selectedClipAsset.name}</strong>
            <p className="fine">
              Start {selectedClip.start.toFixed(2)}s / Duration {selectedClip.duration.toFixed(2)}s / Source {selectedClip.offset.toFixed(2)}-{(selectedClip.offset + selectedClip.duration).toFixed(2)}s
            </p>
            {whisperBlockedForSelectedClip ? (
              <p className="fine">[WARN] Whisper is disabled for generated music/SFX assets.</p>
            ) : null}
            <div className="button-row">
              <button className="button compact" type="button" onClick={onSaveAsset}>
                Render clip
              </button>
              <button className="button compact" type="button" onClick={onSaveVoiceSelection}>
                Save voice
              </button>
              <button className="button compact" type="button" disabled={!canTranscribeSelectedClip} onClick={onTranscribe}>
                Transcribe
              </button>
            </div>
            <div className="clip-mix">
              <label className="field field-row">
                <span className="field-label"><span className="label">Gain</span></span>
                <span className="range-row row-control">
                  <input type="range" min={0} max={2} step={0.05} value={selectedClip.gain}
                    onChange={(event) => onPatchClip(selectedClip.id, (c) => ({ ...c, gain: Number(event.target.value) }))} />
                  <input className="input number-input" type="number" min={0} max={2} step={0.05} value={selectedClip.gain}
                    onChange={(event) => onPatchClip(selectedClip.id, (c) => ({ ...c, gain: Number(event.target.value) }))} />
                </span>
              </label>
              <label className="field field-row">
                <span className="field-label"><span className="label">Fade in (s)</span></span>
                <span className="range-row row-control">
                  <input type="range" min={0} max={Math.max(0.1, selectedClip.duration / 2)} step={0.02} value={selectedClip.fadeIn}
                    onChange={(event) => onPatchClip(selectedClip.id, (c) => ({ ...c, fadeIn: Number(event.target.value) }))} />
                  <input className="input number-input" type="number" min={0} step={0.02} value={selectedClip.fadeIn}
                    onChange={(event) => onPatchClip(selectedClip.id, (c) => ({ ...c, fadeIn: Number(event.target.value) }))} />
                </span>
              </label>
              <label className="field field-row">
                <span className="field-label"><span className="label">Fade out (s)</span></span>
                <span className="range-row row-control">
                  <input type="range" min={0} max={Math.max(0.1, selectedClip.duration / 2)} step={0.02} value={selectedClip.fadeOut}
                    onChange={(event) => onPatchClip(selectedClip.id, (c) => ({ ...c, fadeOut: Number(event.target.value) }))} />
                  <input className="input number-input" type="number" min={0} step={0.02} value={selectedClip.fadeOut}
                    onChange={(event) => onPatchClip(selectedClip.id, (c) => ({ ...c, fadeOut: Number(event.target.value) }))} />
                </span>
              </label>
            </div>
            <label className="field compact-field">
              <span>Region start</span>
              <input className="input" type="number" value={region.start} onChange={(event) => onRegionChange((r) => ({ ...r, start: Number(event.target.value) }))} />
            </label>
            <label className="field compact-field">
              <span>Region end</span>
              <input className="input" type="number" value={region.end} onChange={(event) => onRegionChange((r) => ({ ...r, end: Number(event.target.value) }))} />
            </label>
          </div>
        ) : selectedAsset ? (
          <div className="inspector-card">
            <strong>{selectedAsset.name}</strong>
            <p className="fine">{selectedAsset.source} / {formatTime(selectedAsset.duration || 0)}</p>
            <div className="player-strip" onClickCapture={onEngagePlayer}>
              <AudioPlayerButton
                item={{ id: selectedAsset.id, src: selectedAsset.url }}
                variant="outline"
                size="icon"
                aria-label={`Play ${selectedAsset.name}`}
              />
              <AudioPlayerTime className="player-time" />
              <AudioPlayerProgress className="player-progress" />
              <AudioPlayerDuration className="player-time" />
            </div>
            <div className="button-row">
              <button className="button compact" type="button" onClick={() => onAddToTimeline(selectedAsset)}>
                Add
              </button>
              <button className="button compact" type="button" onClick={() => onSaveVoiceAsset(selectedAsset)}>
                Save voice
              </button>
            </div>
          </div>
        ) : (
          <p className="fine">Select media or a clip to inspect editing actions.</p>
        )}

        {(selectedClipTranscript.length || selectedClipAsset?.transcript) && selectedClip ? (
          <div className="inspector-card transcript-card">
            <div className="section-title compact-title">
              <strong>Transcript</strong>
              <span className="pill">{selectedClipTranscript.length || "text"}</span>
            </div>
            {selectedClipTranscript.length ? (
              <div className="button-row transcript-export">
                <button className="button compact" type="button" onClick={() => onExportCaptions("srt")}>Export SRT</button>
                <button className="button compact" type="button" onClick={() => onExportCaptions("vtt")}>Export VTT</button>
                <button className="button compact" type="button" onClick={onSplitBySpeaker}>Split by speaker</button>
              </div>
            ) : null}
            {selectedClipTranscript.length ? (
              <div className="transcript-list">
                {selectedClipTranscript.map((segment) => (
                  <div className="transcript-row" key={segment.id}>
                    <button
                      className="speaker"
                      type="button"
                      onClick={() => onPlaySpeaker(transcriptSpeakerKey(segment))}
                      aria-label={`Play only ${transcriptSpeakerKey(segment)} transcript blocks`}
                    >
                      {transcriptSpeakerKey(segment)}
                    </button>
                    <button className="transcript-block" type="button" onClick={() => onSelectSegment(segment)}>
                      <span className="fine">{segment.start.toFixed(2)}-{segment.end.toFixed(2)}s</span>
                      <span>{segment.text}</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="fine">{selectedClipAsset?.transcript}</p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
