"use client";

import * as React from "react";
import { FeaturedModelCard } from "@/components/featured-model-card";
import { FieldEditor, InfoTip, MentionTextarea } from "@/components/generate-fields";
import { ModelBadges, ProviderMark } from "@/components/provider-mark";
import {
  AudioPlayerButton,
  AudioPlayerDuration,
  AudioPlayerProgress,
  AudioPlayerTime
} from "@/components/ui/audio-player";
import {
  MAX_CINEMATIC_CAST,
  validateComposeCharacters,
  type ComposeCharacter
} from "@/lib/cinematic-cast";
import type { CinematicProgress } from "@/lib/cinematic-runner";
import { findMentionedTargets } from "@/lib/mentions";
import type { ModelDefinition } from "@/lib/model-catalog";
import { visibleSchemaFields, type ModelSchemaField } from "@/lib/model-schemas";
import { formatTime, type SpeakerBlock } from "@/lib/studio-helpers";
import type { PromptEnhanceState, RunUiState, TimelineSelection } from "@/lib/studio-types";
import type { Asset, Clip, Voice } from "@/lib/types";

// Generate models whose length field can be matched to a selected timeline region.
const durationFieldByModel: Record<string, string> = {
  "eleven-sfx": "duration_seconds",
  "stable-audio": "seconds_total",
  mmaudio: "duration",
  "stable-audio-to-audio": "total_seconds"
};

export interface ModelPickerProps {
  open: boolean;
  query: string;
  providerFilter: string;
  taskFilter: string;
  bestForFilter: string;
  activeIndex: number;
  featuredExpanded: boolean;
  filteredModels: ModelDefinition[];
  providerFilters: string[];
  taskFilters: string[];
  bestForFilters: string[];
  featuredModels: ModelDefinition[];
  groupedModels: Array<{ provider: string; models: ModelDefinition[] }>;
  keyboardModel: ModelDefinition | undefined;
  onToggleOpen: () => void;
  onQueryChange: (query: string) => void;
  onProviderFilter: (value: string) => void;
  onTaskFilter: (value: string) => void;
  onBestForFilter: (value: string) => void;
  onActiveIndexChange: React.Dispatch<React.SetStateAction<number>>;
  onToggleFeatured: () => void;
  onPick: (id: string) => void;
}

export function GeneratePanel({
  generatePanelRef,
  projectId,
  leftCollapsed,
  model,
  picker,
  promptFieldName,
  timelineSelection,
  values,
  voices,
  selectedVoiceId,
  selectedClipAsset,
  sourceContextClip,
  selectedSourceClip,
  selectedVoice,
  voiceAsset,
  activeSpeaker,
  activeSpeakerBlocks,
  runDisabledReason,
  promptValue,
  enhanced,
  promptEnhance,
  promptEnhanceReady,
  promptEnhanceFailed,
  promptIsEnhancing,
  lint,
  runState,
  runStateCard,
  latestOutputs,
  latestRun,
  onExpand,
  onCollapse,
  onRoute,
  onSetField,
  onSelectVoice,
  onUploadFieldFile,
  onSaveSpeakerVoice,
  onSpeakerModel,
  onRun,
  onAddToTimeline,
  onEngagePlayer,
  onGenerateBrief
}: {
  generatePanelRef: React.Ref<HTMLElement>;
  projectId: string;
  leftCollapsed: boolean;
  model: ModelDefinition;
  picker: ModelPickerProps;
  promptFieldName: string | undefined;
  timelineSelection: TimelineSelection | null;
  values: Record<string, string | number | boolean>;
  voices: Voice[];
  selectedVoiceId: string;
  selectedClipAsset?: Asset;
  sourceContextClip?: Clip;
  selectedSourceClip?: Clip;
  selectedVoice?: Voice;
  voiceAsset?: Asset;
  activeSpeaker: string;
  activeSpeakerBlocks: SpeakerBlock[];
  runDisabledReason?: string;
  promptValue: string;
  enhanced: string;
  promptEnhance: PromptEnhanceState;
  promptEnhanceReady: boolean;
  promptEnhanceFailed: boolean;
  promptIsEnhancing: boolean;
  lint: { warnings: string[] };
  runState: RunUiState;
  runStateCard: React.ReactNode;
  latestOutputs: Asset[];
  latestRun?: { modelId: string };
  onExpand: () => void;
  onCollapse: () => void;
  onRoute: () => void;
  onSetField: (name: string, value: string | number | boolean) => void;
  onSelectVoice: (id: string) => void;
  onUploadFieldFile: (field: ModelSchemaField, file: File) => Promise<void>;
  onSaveSpeakerVoice: () => void;
  onSpeakerModel: (modelId: string) => void;
  onRun: () => void;
  onAddToTimeline: (asset: Asset) => void;
  onEngagePlayer: () => void;
  onGenerateBrief: (
    brief: string,
    characters: ComposeCharacter[],
    onProgress: (p: CinematicProgress) => void,
    signal: AbortSignal
  ) => Promise<void>;
}) {
  // Compose (brief → full auto-composed piece) vs Manual (pick a model + prompt).
  // Compose leads: one line in, a finished multi-layer piece out on a new project.
  const [mode, setMode] = React.useState<"compose" | "manual">("compose");
  const [brief, setBrief] = React.useState("");
  const [composeBusy, setComposeBusy] = React.useState(false);
  const [composeProgress, setComposeProgress] = React.useState<CinematicProgress | null>(null);
  const [composeError, setComposeError] = React.useState("");
  const [characters, setCharacters] = React.useState<ComposeCharacter[]>([]);
  const [touchedCharacterFields, setTouchedCharacterFields] = React.useState<Record<string, boolean>>({});
  const [composeValidationAttempted, setComposeValidationAttempted] = React.useState(false);
  const composeControllerRef = React.useRef<AbortController | null>(null);
  const composeProjectIdRef = React.useRef(projectId);
  const nextCharacterIdRef = React.useRef(1);
  React.useEffect(() => {
    if (composeProjectIdRef.current === projectId) return;
    composeProjectIdRef.current = projectId;
    const controller = composeControllerRef.current;
    composeControllerRef.current = null;
    controller?.abort();
    setBrief("");
    setComposeBusy(false);
    setComposeProgress(null);
    setComposeError("");
    setCharacters([]);
    setTouchedCharacterFields({});
    setComposeValidationAttempted(false);
  }, [projectId]);
  const activeCharacters = composeProjectIdRef.current === projectId ? characters : [];
  const characterValidations = validateComposeCharacters(activeCharacters);
  const characterTargets = characterValidations.flatMap((validation) =>
    validation.normalizedName && !validation.nameError
      ? [{ id: validation.id, name: validation.normalizedName }]
      : []
  );
  const mentionedCharacters = findMentionedTargets(brief, characterTargets);
  const composePct =
    composeProgress && composeProgress.total > 0
      ? Math.round((composeProgress.done / composeProgress.total) * 100)
      : 0;

  function addCharacter() {
    setCharacters((current) => {
      if (current.length >= MAX_CINEMATIC_CAST) return current;
      const id = `compose-character-${nextCharacterIdRef.current}`;
      nextCharacterIdRef.current += 1;
      return [...current, { id, name: "", voiceId: "" }];
    });
  }

  function updateCharacter(id: string, patch: Partial<Pick<ComposeCharacter, "name" | "voiceId">>) {
    setComposeError("");
    setCharacters((current) =>
      current.map((character) => (character.id === id ? { ...character, ...patch } : character))
    );
  }

  function removeCharacter(id: string) {
    setComposeError("");
    setCharacters((current) => current.filter((character) => character.id !== id));
  }

  function touchCharacterField(id: string, field: "name" | "voiceId") {
    const key = `${id}:${field}`;
    setTouchedCharacterFields((current) => (current[key] ? current : { ...current, [key]: true }));
  }

  async function runCompose() {
    if (!brief.trim() || composeBusy) return;
    const invalidIndex = characterValidations.findIndex((validation) => !validation.valid);
    if (invalidIndex >= 0) {
      const validation = characterValidations[invalidIndex];
      setComposeValidationAttempted(true);
      setComposeError(`Character ${invalidIndex + 1}: ${validation.nameError ?? validation.voiceError}.`);
      return;
    }
    setComposeBusy(true);
    setComposeError("");
    setComposeProgress({ phase: "Planning the piece", done: 0, total: 0 });
    const controller = new AbortController();
    composeControllerRef.current = controller;
    try {
      await onGenerateBrief(
        brief.trim(),
        activeCharacters.map((character) => ({ ...character })),
        setComposeProgress,
        controller.signal
      );
      if (composeControllerRef.current !== controller) return;
      setBrief("");
      setComposeProgress(null);
    } catch (err) {
      if (composeControllerRef.current !== controller) return;
      if (controller.signal.aborted) {
        setComposeError("");
        setComposeProgress(null);
      } else {
        setComposeError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (composeControllerRef.current === controller) {
        setComposeBusy(false);
        composeControllerRef.current = null;
      }
    }
  }

  return (
    <aside className="panel generate-panel" ref={generatePanelRef}>
      {leftCollapsed ? (
        <button
          className="panel-collapsed-strip"
          type="button"
          title="Expand Generate panel ([)"
          onClick={onExpand}
        >
          <span>GENERATE</span>
        </button>
      ) : null}
      <div className="panel-scroll">
        <section className="section">
          <div className="section-title">
            <div className="gen-tabs" role="tablist" aria-label="Generate mode">
              <button
                className={`gen-tab ${mode === "compose" ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={mode === "compose"}
                onClick={() => setMode("compose")}
              >
                ✦ Compose
              </button>
              <button
                className={`gen-tab ${mode === "manual" ? "active" : ""}`}
                type="button"
                role="tab"
                aria-selected={mode === "manual"}
                onClick={() => setMode("manual")}
              >
                Manual
              </button>
            </div>
            {mode === "manual" ? (
              <button
                className="button ghost"
                type="button"
                title="Auto-pick the best model for your prompt and selection"
                onClick={onRoute}
              >
                Route
              </button>
            ) : null}
            <button
              className="panel-collapse-button"
              type="button"
              title="Collapse panel ([)"
              aria-label="Collapse Generate panel"
              onClick={onCollapse}
            >
              ‹
            </button>
          </div>

          {mode === "compose" ? (
            <div className="compose-body">
              <p className="fine compose-lead">
                Describe any audio piece — a trailer, a podcast, an ad, a meditation, a dialogue scene. An LLM writes the
                script; the studio generates it, keeps voices consistent, ducks the mix, and drops it on a new project.
                Only what the piece needs gets built. A few minutes, live jobs.
              </p>
              <details className="compose-characters">
                <summary>
                  <span className="compose-characters-title">
                    Characters
                    <InfoTip text="Aliases can be @mentioned in the description. Add Narrator as a character if the piece needs a specific narrator voice." />
                  </span>
                  <span>{activeCharacters.length ? `${activeCharacters.length}/${MAX_CINEMATIC_CAST}` : "Optional"}</span>
                </summary>
                <div className="compose-character-list">
                  {activeCharacters.map((character, index) => {
                    const validation = characterValidations[index];
                    const showNameError =
                      Boolean(validation.nameError) &&
                      (composeValidationAttempted || touchedCharacterFields[`${character.id}:name`]);
                    const showVoiceError =
                      Boolean(validation.voiceError) &&
                      (composeValidationAttempted || touchedCharacterFields[`${character.id}:voiceId`]);
                    const nameErrorId = `${character.id}-name-error`;
                    const voiceErrorId = `${character.id}-voice-error`;
                    return (
                      <div className="compose-character-row" key={character.id}>
                        <span className="compose-character-control">
                          <input
                            className="input"
                            aria-label={`Character ${index + 1} alias`}
                            aria-invalid={showNameError}
                            aria-describedby={showNameError ? nameErrorId : undefined}
                            placeholder={`Character ${index + 1}`}
                            maxLength={40}
                            value={character.name}
                            disabled={composeBusy}
                            onBlur={() => touchCharacterField(character.id, "name")}
                            onChange={(event) => updateCharacter(character.id, { name: event.target.value })}
                          />
                          {showNameError ? (
                            <span className="compose-character-error" id={nameErrorId}>
                              {validation.nameError}
                            </span>
                          ) : null}
                        </span>
                        <span className="compose-character-control">
                          <select
                            className="select"
                            aria-label={`Character ${index + 1} saved voice`}
                            aria-invalid={showVoiceError}
                            aria-describedby={showVoiceError ? voiceErrorId : undefined}
                            value={character.voiceId}
                            disabled={composeBusy}
                            onBlur={() => touchCharacterField(character.id, "voiceId")}
                            onChange={(event) => updateCharacter(character.id, { voiceId: event.target.value })}
                          >
                            <option value="">Saved voice</option>
                            {voices.map((voice) => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name}
                              </option>
                            ))}
                          </select>
                          {showVoiceError ? (
                            <span className="compose-character-error" id={voiceErrorId}>
                              {validation.voiceError}
                            </span>
                          ) : null}
                        </span>
                        <button
                          className="compose-character-remove"
                          type="button"
                          aria-label={`Remove ${character.name || `character ${index + 1}`}`}
                          disabled={composeBusy}
                          onClick={() => removeCharacter(character.id)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  {activeCharacters.length < MAX_CINEMATIC_CAST ? (
                    <button
                      className="button compact ghost compose-character-add"
                      type="button"
                      disabled={composeBusy}
                      onClick={addCharacter}
                    >
                      + Character
                    </button>
                  ) : null}
                </div>
              </details>
              <MentionTextarea
                className="compose-input"
                value={brief}
                onChange={setBrief}
                targets={characterTargets}
                disabled={composeBusy}
                aria-label="Compose description"
                placeholder="e.g. @Host opens the show, then @Guest answers"
              />
              {mentionedCharacters.length ? (
                <span className="mention-chips compose-mention-chips" aria-label="Mentioned characters">
                  {mentionedCharacters.map((character) => (
                    <span className="mention-chip" key={character.id}>
                      @{character.name}
                    </span>
                  ))}
                </span>
              ) : null}
              {composeBusy && composeProgress ? (
                <div className="compose-progress">
                  <div className="compose-progress-head">
                    <span>{composeProgress.phase}…</span>
                    <span>{composeProgress.total > 0 ? `${composeProgress.done}/${composeProgress.total}` : ""}</span>
                  </div>
                  <span className="progress-track" aria-hidden="true">
                    <span className="progress-fill" style={{ width: `${composePct}%` }} />
                  </span>
                </div>
              ) : null}
              {composeError ? <p className="fine compose-error">[ERROR] {composeError}</p> : null}
              <div className="button-row">
                {composeBusy ? (
                  <button className="button" type="button" onClick={() => composeControllerRef.current?.abort()}>
                    Cancel
                  </button>
                ) : (
                  <button className="button primary" type="button" onClick={runCompose} disabled={!brief.trim()}>
                    Generate piece
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {mode === "manual" ? (
          <>
          <div className="model-picker-shell" onClick={(event) => event.stopPropagation()}>
            <span className="label">Model</span>
            <button
              className="model-select-button"
              type="button"
              aria-expanded={picker.open}
              onClick={picker.onToggleOpen}
            >
              <ProviderMark model={model} size={20} />
              <span className="model-select-main">
                <strong>{model.label}</strong>
                <span>{model.provider} / {model.task}</span>
              </span>
              <span className="model-chevron">⌄</span>
            </button>
            {picker.open ? (
              <div className="model-picker-popover">
                <input
                  className="input model-search"
                  type="search"
                  placeholder="Search models"
                  aria-label="Search models"
                  value={picker.query}
                  onChange={(event) => picker.onQueryChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      const delta = event.key === "ArrowDown" ? 1 : -1;
                      picker.onActiveIndexChange((current) => {
                        const count = picker.filteredModels.length;
                        if (!count) return -1;
                        return (current + delta + count) % count;
                      });
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const target = picker.filteredModels[picker.activeIndex] ?? picker.filteredModels[0];
                      if (target) picker.onPick(target.id);
                    }
                  }}
                />
                <div className="model-filter-row">
                  <select className="select compact-select" value={picker.providerFilter} onChange={(event) => picker.onProviderFilter(event.target.value)}>
                    <option value="">Provider</option>
                    {picker.providerFilters.map((provider) => (
                      <option key={provider} value={provider}>{provider}</option>
                    ))}
                  </select>
                  <select className="select compact-select" value={picker.taskFilter} onChange={(event) => picker.onTaskFilter(event.target.value)}>
                    <option value="">Task</option>
                    {picker.taskFilters.map((task) => (
                      <option key={task} value={task}>{task}</option>
                    ))}
                  </select>
                  <select className="select compact-select" value={picker.bestForFilter} onChange={(event) => picker.onBestForFilter(event.target.value)}>
                    <option value="">Best for</option>
                    {picker.bestForFilters.map((bestFor) => (
                      <option key={bestFor} value={bestFor}>{bestFor}</option>
                    ))}
                  </select>
                </div>
                {picker.featuredModels.length ? (
                  <div className="model-picker-section">
                    <span className="label">Featured</span>
                    <div className="featured-grid">
                      {(picker.featuredExpanded ? picker.featuredModels : picker.featuredModels.slice(0, 3)).map((item) => (
                        <FeaturedModelCard
                          key={`featured-${item.id}`}
                          model={item}
                          active={item.id === model.id}
                          onSelect={() => picker.onPick(item.id)}
                        />
                      ))}
                    </div>
                    {picker.featuredModels.length > 3 ? (
                      <button
                        className="button compact ghost featured-toggle"
                        type="button"
                        aria-expanded={picker.featuredExpanded}
                        onClick={picker.onToggleFeatured}
                      >
                        {picker.featuredExpanded ? "Show less" : `Show all ${picker.featuredModels.length}`}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="model-picker-section" role="listbox" aria-label="All models">
                  <span className="label">All models</span>
                  {picker.groupedModels.map((group) => (
                    <div className="model-provider-group" key={group.provider}>
                      <span className="model-provider-title">{group.provider} <span>{group.models.length} models</span></span>
                      {group.models.map((item) => (
                        <button
                          className={`model-picker-row ${item.id === model.id ? "active" : ""} ${item.id === picker.keyboardModel?.id ? "kb-active" : ""}`}
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={item.id === model.id}
                          ref={item.id === picker.keyboardModel?.id ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                          onClick={() => picker.onPick(item.id)}
                        >
                          <ProviderMark model={item} />
                          <span className="model-row-main">
                            <strong>{item.label}</strong>
                            <span>{item.description}</span>
                          </span>
                          <ModelBadges model={item} />
                        </button>
                      ))}
                    </div>
                  ))}
                  {!picker.filteredModels.length ? <p className="fine">No models match these filters.</p> : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="model-summary">
            <div className="model-summary-head">
              <ProviderMark model={model} size={20} />
              <span>
                <strong>{model.label}</strong>
                <span className="fine">{model.provider} / {model.kind} / {model.task}</span>
              </span>
              <InfoTip text={model.description} />
            </div>
            <ModelBadges model={model} />
          </div>
          {(() => {
            const fitField = durationFieldByModel[model.id];
            if (!fitField || !timelineSelection) return null;
            const seconds = Math.round((timelineSelection.end - timelineSelection.start) * 10) / 10;
            if (seconds < 0.1) return null;
            const field = visibleSchemaFields(model.id).find((item) => item.name === fitField);
            const clamped = Math.max(field?.min ?? 0.1, Math.min(field?.max ?? seconds, seconds));
            return (
              <button
                className="button compact fit-selection"
                type="button"
                title="Set the length to the selected region"
                onClick={() => onSetField(fitField, clamped)}
              >
                ⇥ Fit to selection ({seconds}s)
              </button>
            );
          })()}
          <FieldEditor
            model={model}
            values={values}
            setValue={onSetField}
            voices={voices}
            uploadFieldFile={onUploadFieldFile}
          />
          {model.needsVoice ? (
            <label className="field">
              <span>Voice</span>
              <select className="select" value={selectedVoiceId} onChange={(event) => onSelectVoice(event.target.value)}>
                <option value="">Select voice</option>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>{voice.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {model.needsSource || model.needsVoice || activeSpeaker ? (
            <div className="attached-context">
              <div className="section-title compact-title">
                <strong>Attached context</strong>
                <span className="pill">{model.task}</span>
              </div>
              {model.needsSource ? (
                <div className="context-row">
                  <span className="label">Source</span>
                  <strong>{selectedClipAsset?.name ?? "No source selected"}</strong>
                  <p className="fine">
                    {sourceContextClip
                      ? `${selectedSourceClip ? "Region render" : "Clip"} / source ${sourceContextClip.offset.toFixed(2)}-${(sourceContextClip.offset + sourceContextClip.duration).toFixed(2)}s`
                      : "Select a clip or region on the timeline."}
                  </p>
                </div>
              ) : null}
              {model.id === "seed-extend" ? (
                <div className="context-row">
                  <span className="label">
                    Voice context <InfoTip text="Seed Extend continues the same voice and topic from the source audio. Long refs are trimmed internally to the latest ~28s of context." />
                  </span>
                  <strong>{sourceContextClip ? "Attached from source audio" : "Waiting for source"}</strong>
                </div>
              ) : model.id === "seed-voice-changer" ? (
                <div className="context-row">
                  <span className="label">Target voice</span>
                  <strong>{selectedVoice?.name ?? "No target voice selected"}</strong>
                  <p className="fine">{voiceAsset ? `Ref ${voiceAsset.name}` : "Pick a saved voice reference."}</p>
                </div>
              ) : model.needsVoice ? (
                <div className="context-row">
                  <span className="label">Attached voice</span>
                  <strong>{selectedVoice ? `${selectedVoice.name} as @Audio1` : "No voice selected"}</strong>
                  <p className="fine">{voiceAsset ? `Ref ${voiceAsset.name}` : "Pick a saved voice reference."}</p>
                </div>
              ) : null}
              {activeSpeaker ? (
                <div className="context-row active-speaker-context">
                  <span className="label">
                    Active speaker <InfoTip text="Speaker actions use the first visible transcript block as the source region." />
                  </span>
                  <strong>{activeSpeaker}</strong>
                  <p className="fine">{activeSpeakerBlocks.length} visible transcript block(s)</p>
                  <div className="button-row attached-actions">
                    <button className="button compact" type="button" disabled={!activeSpeakerBlocks.length} onClick={onSaveSpeakerVoice}>
                      Save speaker as voice
                    </button>
                    <button className="button compact" type="button" disabled={!activeSpeakerBlocks.length} onClick={() => onSpeakerModel("seed-extend")}>
                      Extend speaker
                    </button>
                    <button className="button compact" type="button" disabled={!activeSpeakerBlocks.length} onClick={() => onSpeakerModel("seed-voice-changer")}>
                      Voice-change speaker
                    </button>
                  </div>
                </div>
              ) : null}
              {runDisabledReason ? <p className="fine">[WAIT] {runDisabledReason}</p> : null}
            </div>
          ) : null}
          {model.enhancesPrompt && promptValue && promptEnhanceReady ? (
            <div className="field">
              <span className="label">
                Enhanced Preview [LLM READY]
              </span>
              <p className="prompt-preview">{enhanced}</p>
            </div>
          ) : null}
          {model.enhancesPrompt && promptValue && promptEnhanceFailed ? (
            <div className="field">
              <span className="label">Enhanced Preview [ERROR]</span>
              <p className="fine">[ERROR] {promptEnhance.error ?? "Prompt enhancement failed."}</p>
            </div>
          ) : null}
          {promptValue.trim() && lint.warnings.length ? (
            <div className="field">
              <span className="label">Prompt Checks</span>
              {lint.warnings.map((warning) => (
                <p className="fine" key={warning}>[WARN] {warning}</p>
              ))}
            </div>
          ) : null}
          <div className="button-row">
            <button
              className="button primary"
              type="button"
              disabled={Boolean(runDisabledReason) || runState.status === "validating" || runState.status === "submitting"}
              onClick={onRun}
            >
              {promptIsEnhancing ? "Enhancing..." : runState.status === "submitting" ? "Running..." : "Run Model"}
            </button>
          </div>
          {runState.status !== "idle" ? runStateCard : null}
          {latestOutputs.length ? (
            <div className="inspector-card output-card">
              <span className="label">Latest Output</span>
              {latestOutputs.map((asset) => (
                <div className="output-row" key={asset.id}>
                  <span className="asset-main">
                    <strong>{asset.name}</strong>
                    <span className="fine">{formatTime(asset.duration || 0)} / {latestRun?.modelId}</span>
                  </span>
                  <span className="output-actions">
                    <button className="button compact" type="button" onClick={() => onAddToTimeline(asset)}>
                      Add
                    </button>
                    <a className="button compact" href={asset.url} download={asset.name} target="_blank" rel="noreferrer">
                      Save
                    </a>
                  </span>
                </div>
              ))}
              {latestOutputs[0] ? (
                <div className="player-strip" onClickCapture={onEngagePlayer}>
                  <AudioPlayerButton
                    item={{ id: latestOutputs[0].id, src: latestOutputs[0].url }}
                    variant="outline"
                    size="icon"
                    aria-label={`Play ${latestOutputs[0].name}`}
                  />
                  <AudioPlayerTime className="player-time" />
                  <AudioPlayerProgress className="player-progress" />
                  <AudioPlayerDuration className="player-time" />
                </div>
              ) : null}
            </div>
          ) : null}
          </>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
