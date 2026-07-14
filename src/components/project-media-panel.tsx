"use client";

import * as React from "react";
import { formatTime } from "@/lib/studio-helpers";
import type { ProjectFilter, RenameTarget } from "@/lib/studio-types";
import type { Asset, Voice } from "@/lib/types";

const PROJECT_FILTERS: ProjectFilter[] = ["all", "upload", "generated", "derived", "voices"];

export function ProjectMediaPanel({
  assets,
  voices,
  filteredAssets,
  filteredVoices,
  assetQuery,
  projectFilter,
  selectedAsset,
  selectedAssetId,
  selectedVoiceId,
  previewAssetId,
  renaming,
  onCollapse,
  onQueryChange,
  onFilterChange,
  onUpload,
  onSelectAsset,
  onSelectVoice,
  onAddToTimeline,
  onTogglePreview,
  onRenameAsset,
  onRenameVoice,
  onSetRenaming,
  onSaveVoice,
  onAssetMenu,
  onVoiceMenu
}: {
  assets: Asset[];
  voices: Voice[];
  filteredAssets: Asset[];
  filteredVoices: Voice[];
  assetQuery: string;
  projectFilter: ProjectFilter;
  selectedAsset?: Asset;
  selectedAssetId: string;
  selectedVoiceId: string;
  previewAssetId: string;
  renaming: RenameTarget | null;
  onCollapse: () => void;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: ProjectFilter) => void;
  onUpload: (file: File) => void;
  onSelectAsset: (id: string) => void;
  onSelectVoice: (id: string) => void;
  onAddToTimeline: (asset: Asset) => void;
  onTogglePreview: (asset: Asset) => void;
  onRenameAsset: (id: string, name: string) => void;
  onRenameVoice: (id: string, name: string) => void;
  onSetRenaming: (target: RenameTarget | null) => void;
  onSaveVoice: (asset: Asset) => void;
  onAssetMenu: (event: React.MouseEvent, asset: Asset) => void;
  onVoiceMenu: (event: React.MouseEvent, voice: Voice) => void;
}) {
  return (
    <div className="rail-section project-region">
      <section className="section project-panel">
        <div className="section-title">
          <h2>Project</h2>
          <span className="pill">{assets.length + voices.length}</span>
          <button
            className="panel-collapse-button"
            type="button"
            title="Collapse panel (])"
            aria-label="Collapse Project panel"
            onClick={onCollapse}
          >
            ›
          </button>
        </div>
        <input
          className="input project-search"
          type="search"
          placeholder="Search media"
          value={assetQuery}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <div className="project-filters" role="tablist" aria-label="Project filters">
          {PROJECT_FILTERS.map((filter) => (
            <button
              key={filter}
              className={projectFilter === filter ? "active" : ""}
              type="button"
              aria-pressed={projectFilter === filter}
              onClick={() => onFilterChange(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        <label className="button compact import-button" title="Or drop audio files anywhere in the window">
          + Import audio
          <input
            type="file"
            hidden
            accept="audio/*"
            multiple
            onChange={(event) => {
              for (const file of Array.from(event.target.files ?? [])) onUpload(file);
              event.target.value = "";
            }}
          />
        </label>
        {projectFilter !== "voices" ? (
          <>
        <div className="asset-list project-list">
          {filteredAssets.map((asset) => (
            <div
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/plain", asset.id)}
              className={`asset ${asset.id === selectedAssetId ? "active" : ""}`}
              key={asset.id}
              onClick={() => onSelectAsset(asset.id)}
              onDoubleClick={() => onAddToTimeline(asset)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectAsset(asset.id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelectAsset(asset.id);
                onAssetMenu(event, asset);
              }}
            >
              <span className="asset-kind">{asset.source.slice(0, 3).toUpperCase()}</span>
              <span className="asset-main">
                {renaming?.kind === "asset" && renaming.id === asset.id ? (
                  <input
                    className="row-name-input"
                    autoFocus
                    defaultValue={asset.name}
                    aria-label={`Rename ${asset.name}`}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={(event) => {
                      onRenameAsset(asset.id, event.target.value);
                      onSetRenaming(null);
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        onRenameAsset(asset.id, event.currentTarget.value);
                        onSetRenaming(null);
                      }
                      if (event.key === "Escape") onSetRenaming(null);
                    }}
                  />
                ) : (
                  <strong>{asset.name}</strong>
                )}
                <span className="fine">{formatTime(asset.duration || 0)} / {asset.derivedFrom?.operation ?? "source"}</span>
              </span>
              <span className="asset-badges">
                {asset.transcript ? <span className="pill">TXT</span> : null}
                {asset.derivedFrom ? <span className="pill red">DRV</span> : null}
                <button
                  type="button"
                  className={`asset-play ${previewAssetId === asset.id ? "active" : ""}`}
                  aria-label={previewAssetId === asset.id ? `Stop preview of ${asset.name}` : `Preview ${asset.name}`}
                  title={previewAssetId === asset.id ? "Stop preview" : "Preview"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePreview(asset);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {previewAssetId === asset.id ? "■" : "▶"}
                </button>
              </span>
            </div>
          ))}
        </div>
        {!filteredAssets.length ? (
          <p className="fine">
            {assets.length === 0
              ? "No assets yet. Upload audio above or run a model in Generate."
              : "No matching assets."}
          </p>
        ) : null}
          </>
        ) : null}
      </section>

      {projectFilter === "all" || projectFilter === "voices" ? (
        <section className="section">
          <div className="section-title">
            <h2>Voices</h2>
            <span className="pill">{filteredVoices.length}</span>
          </div>
          <div className="voice-list">
            {filteredVoices.map((voice) => {
              const refAsset = assets.find((item) => item.id === voice.refAssetId);
              return (
                <div
                  role="button"
                  tabIndex={0}
                  className={`voice-row ${voice.id === selectedVoiceId ? "active" : ""}`}
                  key={voice.id}
                  onClick={() => onSelectVoice(voice.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectVoice(voice.id);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectVoice(voice.id);
                    onVoiceMenu(event, voice);
                  }}
                >
                  <span className="voice-main">
                    {renaming?.kind === "voice" && renaming.id === voice.id ? (
                      <input
                        className="row-name-input"
                        autoFocus
                        defaultValue={voice.name}
                        aria-label={`Rename ${voice.name}`}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={(event) => {
                          onRenameVoice(voice.id, event.target.value);
                          onSetRenaming(null);
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            onRenameVoice(voice.id, event.currentTarget.value);
                            onSetRenaming(null);
                          }
                          if (event.key === "Escape") onSetRenaming(null);
                        }}
                      />
                    ) : (
                      <strong>{voice.name}</strong>
                    )}
                    <span className="fine">{voice.provider ?? "local"} reference</span>
                  </span>
                  {refAsset ? (
                    <button
                      type="button"
                      className={`asset-play ${previewAssetId === refAsset.id ? "active" : ""}`}
                      aria-label={previewAssetId === refAsset.id ? `Stop preview of ${voice.name}` : `Preview ${voice.name}`}
                      title={previewAssetId === refAsset.id ? "Stop preview" : "Preview"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePreview(refAsset);
                      }}
                    >
                      {previewAssetId === refAsset.id ? "■" : "▶"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          {!filteredVoices.length ? (
            <p className="fine">No voice references yet. Select an asset and use Save Voice, or right-click one.</p>
          ) : null}
        </section>
      ) : null}

      <section className="section">
        <div className="button-row">
          <button className="button" type="button" disabled={!selectedAsset} onClick={() => selectedAsset && onAddToTimeline(selectedAsset)}>
            Add
          </button>
          <button className="button" type="button" disabled={!selectedAsset} onClick={() => selectedAsset && onSaveVoice(selectedAsset)}>
            Save Voice
          </button>
        </div>
      </section>
    </div>
  );
}
