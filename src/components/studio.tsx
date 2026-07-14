"use client";

import * as React from "react";
import { isWhisperBlockedAsset } from "@/lib/asset-rules";
import { audibleWindow, audioDuration, measureLevel, storeBlob, uploadToStorage } from "@/lib/audio-io";
import { DUCK_DB, duckGain, median } from "@/lib/loudness";
import { renderClipToWav, renderTimelineToWav } from "@/lib/audio-export";
import { toSrt, toVtt } from "@/lib/captions";
import { cutClipRegionToGap, moveClipBy, placeWithoutOverlap, snapStart, splitClipAt, trailingWindow, trimClipEndBy, trimClipStartBy } from "@/lib/clip-edit";
import { useFileDrop } from "@/hooks/use-file-drop";
import { useModelPicker } from "@/hooks/use-model-picker";
import { useProjectSnapshot } from "@/hooks/use-project-snapshot";
import { useTimelineZoom } from "@/hooks/use-timeline-zoom";
import { createDerivedAsset } from "@/lib/lineage";
import { findMentionedTargets } from "@/lib/mentions";
import { buildModelRunInput, type MentionVoiceRef } from "@/lib/model-input";
import { planTransformPlacement } from "@/lib/output-placement";
import { getModel, modelCatalog, routeModelForPrompt, seedAudioEndpoint, type ModelDefinition } from "@/lib/model-catalog";
import { visibleSchemaFields, type ModelSchemaField } from "@/lib/model-schemas";
import { lintPrompt } from "@/lib/prompt-intelligence";
import { assetSegmentToTimelineRegion, regionToSourceSeconds } from "@/lib/region";
import { trimPlan, type AudibleWindow } from "@/lib/silence";
import {
  buildOutputName,
  clipUsesEditedSource,
  defaultSnapshot,
  defaultsFor,
  firstTrack,
  formatTime,
  now,
  orderedRegion,
  publicInput,
  regionClipFor,
  requestedOutputDuration,
  snapSecond,
  speakerBlocksFor,
  uid
} from "@/lib/studio-helpers";
import {
  addTrack as addTrackOp,
  deleteTrack as deleteTrackOp,
  duplicateTrack as duplicateTrackOp,
  moveTrack as moveTrackOp,
  normalizeTrackOrder,
  playbackClipVolume,
  renameTrack as renameTrackOp,
  setTrackGain as setTrackGainOp,
  toggleTrackMute,
  toggleTrackSolo,
  type PlaybackClipRef
} from "@/lib/track-ops";
import { offsetTranscript } from "@/lib/transcript";
import { resolveComposeCast, type ComposeCharacter } from "@/lib/cinematic-cast";
import { runCinematic, type CinematicProgress } from "@/lib/cinematic-runner";
import type { CinematicSpec } from "@/lib/cinematic-spec";
import type { MenuItem, MenuState } from "@/components/context-menu-view";
import { PlayerBridge } from "@/components/featured-model-card";
import { GeneratePanel } from "@/components/generate-panel";
import { InspectorPanel } from "@/components/inspector-panel";
import { ProjectMediaPanel } from "@/components/project-media-panel";
import { StudioOverlays } from "@/components/studio-overlays";
import { StudioTopbar } from "@/components/studio-topbar";
import { StudioTransport } from "@/components/studio-transport";
import { TimelineView } from "@/components/timeline-view";
import { AudioPlayerProvider } from "@/components/ui/audio-player";
import type { Asset, Clip, Job, ModelOutput, ProjectSnapshot, Region, Track, TrackKind, TranscriptSegment, Voice } from "@/lib/types";
import type {
  PromptEnhanceState,
  ProjectFilter,
  RunUiState,
  TimelineSelection,
  TransportStatus
} from "@/lib/studio-types";

const seedReferenceMaxSeconds = 30;
// Debug fixture: a loose multi-speaker request used to exercise the enhancer / cast handling.
export function Studio() {
  const {
    snapshot,
    setSnapshot,
    saving,
    patchSnapshot,
    patchTracks,
    projects,
    switchProject,
    createProject,
    addProject,
    seedProjects
  } = useProjectSnapshot();
  const [selectedModelId, setSelectedModelId] = React.useState("seed-scene");
  const [values, setValues] = React.useState<Record<string, string | number | boolean>>(
    defaultsFor(modelCatalog[0])
  );
  const [selectedAssetId, setSelectedAssetId] = React.useState<string>("");
  const [selectedClipId, setSelectedClipId] = React.useState<string>("");
  const [selectedVoiceId, setSelectedVoiceId] = React.useState<string>("");
  const [region, setRegion] = React.useState<Region>({ start: 0, end: 4 });
  const [timelineSelection, setTimelineSelection] = React.useState<TimelineSelection | null>(null);
  const [status, setStatus] = React.useState("[READY]");
  const [runState, setRunState] = React.useState<RunUiState>({
    status: "idle",
    label: "Ready"
  });
  const [promptEnhance, setPromptEnhance] = React.useState<PromptEnhanceState>({
    modelId: "",
    raw: "",
    voiceKey: "",
    enhanced: "",
    status: "idle"
  });
  const [transportStatus, setTransportStatus] = React.useState<TransportStatus>("stopped");
  const [playhead, setPlayhead] = React.useState(0);
  const [menu, setMenu] = React.useState<MenuState | null>(null);
  const [renaming, setRenaming] = React.useState<{ kind: "asset" | "voice"; id: string } | null>(null);
  const [leftCollapsed, setLeftCollapsed] = React.useState(false);
  const [rightCollapsed, setRightCollapsed] = React.useState(false);
  const [addTrackMenuOpen, setAddTrackMenuOpen] = React.useState(false);
  const [compactTracks, setCompactTracks] = React.useState(true);
  const [renamingTrackId, setRenamingTrackId] = React.useState<string>("");
  const [assetQuery, setAssetQuery] = React.useState("");
  const [projectFilter, setProjectFilter] = React.useState<ProjectFilter>("all");
  const {
    modelPickerOpen,
    setModelPickerOpen,
    modelQuery,
    setModelQuery,
    modelProviderFilter,
    setModelProviderFilter,
    modelTaskFilter,
    setModelTaskFilter,
    modelBestForFilter,
    setModelBestForFilter,
    modelActiveIndex,
    setModelActiveIndex,
    featuredExpanded,
    setFeaturedExpanded,
    modelProviderFilters,
    modelTaskFilters,
    modelBestForFilters,
    filteredModelsForPicker,
    featuredModels,
    groupedPickerModels,
    keyboardModel
  } = useModelPicker();
  const [activeSpeaker, setActiveSpeaker] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [dragOver, setDragOver] = React.useState<{ trackId: string; seconds: number } | null>(null);
  const { fileDragActive } = useFileDrop(importDroppedFiles);
  const [toast, setToast] = React.useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const [runElapsed, setRunElapsed] = React.useState(0);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);
  // First launch only: auto-populate the switcher with the curated showcase pieces
  // (LIFTOFF + cinematic set) without leaving the user's project. One-time per browser.
  const showcaseSeededRef = React.useRef(false);
  React.useEffect(() => {
    if (!snapshot || showcaseSeededRef.current) return;
    showcaseSeededRef.current = true;
    if (localStorage.getItem("showcaseSeeded")) return;
    void (async () => {
      const files = [
        "/showcase-hero.json",
        "/showcase-trailer.json",
        "/showcase-brand.json",
        "/showcase-nature.json",
        "/showcase-noir.json",
        "/showcase-game.json",
        "/showcase-calm.json"
      ];
      const snapshots: ProjectSnapshot[] = [];
      for (const file of files) {
        const dropIn = await fetch(file, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (dropIn?.project?.id) snapshots.push(dropIn as ProjectSnapshot);
      }
      if (snapshots.length) {
        await seedProjects(snapshots, ["preview_radio-show", "preview_e2e-mix"]);
        localStorage.setItem("showcaseSeeded", "1");
      }
    })();
  }, [snapshot, seedProjects]);
  const playbackRef = React.useRef<{
    audios: HTMLAudioElement[];
    timers: number[];
    raf?: number;
    mix?: Array<{ audio: HTMLAudioElement } & PlaybackClipRef>;
  }>({ audios: [], timers: [] });
  // Live handles for the rAF tick: current tracks (so mute/solo/gain apply mid-playback)
  // and the latest playTimeline (so the loop restart schedules against fresh state).
  const tracksLiveRef = React.useRef<Track[]>([]);
  const playTimelineRef = React.useRef<(from?: number) => void>(() => undefined);
  // Bumped on every stop/play so an async playTimeline paused in buffering can detect staleness.
  const playGenRef = React.useRef(0);
  const previewRef = React.useRef<HTMLAudioElement | null>(null);
  const [previewAssetId, setPreviewAssetId] = React.useState("");
  const generatePanelRef = React.useRef<HTMLElement | null>(null);
  const inspectorRef = React.useRef<HTMLDivElement | null>(null);
  const playerPauseRef = React.useRef<(() => void) | null>(null);
  const totalDuration = snapshot ? Math.max(0, ...snapshot.clips.map((clip) => clip.start + clip.duration)) : 0;
  const timelineLoaded = snapshot !== null;
  const { pxPerSecond, tracksRef, rulerTicksRef, zoomIn, zoomOut, zoomFit } = useTimelineZoom(totalDuration, timelineLoaded);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
      if (event.key === "Escape") {
        setMenu(null);
        setMenu(null);
        setAddTrackMenuOpen(false);
        setModelPickerOpen(false);
        setShortcutsOpen(false);
        return;
      }
      if (editing) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedClipId) {
        event.preventDefault();
        deleteClip(selectedClipId);
      }
      if (event.key.toLowerCase() === "s" && selectedClipId) {
        event.preventDefault();
        splitClipAtPlayhead(selectedClipId);
      }
      if (event.code === "Space") {
        event.preventDefault();
        transportStatus === "playing" ? pauseTimeline() : playTimeline();
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 0.5;
        seekTimeline(playhead + (event.key === "ArrowLeft" ? -step : step));
      }
      if (event.key === "+" || event.key === "=") zoomIn();
      if (event.key === "-" || event.key === "_") zoomOut();
      if (event.key === "[") setLeftCollapsed((collapsed) => !collapsed);
      if (event.key === "]") setRightCollapsed((collapsed) => !collapsed);
      if (event.key === "?") setShortcutsOpen((open) => !open);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  React.useEffect(() => {
    // Native app feel: the browser context menu never shows; text fields keep theirs for paste/spellcheck.
    function onContextMenu(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
    }
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  React.useEffect(() => {
    if (runState.status !== "submitting") return;
    setRunElapsed(0);
    const started = Date.now();
    const handle = window.setInterval(() => setRunElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(handle);
  }, [runState.status]);

  React.useEffect(() => {
    const kind = status.includes("[ERROR]")
      ? "err"
      : status.includes("[DONE]") || status.includes("[EXPORTED]") || status.includes("[TRIMMED]")
        ? "ok"
        : null;
    if (!kind) return;
    setToast({ text: status, kind });
    const handle = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(handle);
  }, [status]);

  React.useEffect(() => {
    function closeMenus() {
      setMenu(null);
      setMenu(null);
      setAddTrackMenuOpen(false);
    }
    function closeOnClick() {
      closeMenus();
      setModelPickerOpen(false);
    }
    window.addEventListener("click", closeOnClick);
    window.addEventListener("scroll", closeMenus, true);
    return () => {
      window.removeEventListener("click", closeOnClick);
      window.removeEventListener("scroll", closeMenus, true);
      stopTimeline(false);
    };
  }, []);

  const model = getModel(selectedModelId) ?? modelCatalog[0];
  const orderedTracks = snapshot ? normalizeTrackOrder(snapshot.tracks) : [];
  const latestRun = snapshot?.modelRuns[0];
  const latestOutputs = latestRun
    ? latestRun.outputAssetIds
        .map((id) => snapshot?.assets.find((item) => item.id === id))
        .filter((item): item is Asset => Boolean(item))
    : [];
  const runStateCard = (
    <div className={`run-state ${runState.status}`}>
      <span className="label">Run State</span>
      <strong>{runState.label}</strong>
      {runState.status === "submitting" ? (
        <>
          <span className="progress-track" aria-hidden="true">
            <span className="progress-fill" style={{ width: `${Math.max(runState.progress ?? 0, 5)}%` }} />
          </span>
          <p className="fine">
            {runElapsed}s elapsed{runState.logLine ? ` / ${runState.logLine}` : ""}
          </p>
        </>
      ) : null}
      {runState.jobId ? <p className="fine">Job {runState.jobId}</p> : null}
      {runState.error ? <p className="fine">[ERROR] {runState.error}</p> : null}
    </div>
  );
  const selectedAsset = snapshot?.assets.find((asset) => asset.id === selectedAssetId);
  const selectedClip = snapshot?.clips.find((clip) => clip.id === selectedClipId);
  const selectedClipAsset = selectedClip
    ? snapshot?.assets.find((asset) => asset.id === selectedClip.assetId)
    : undefined;
  const selectedVoice = snapshot?.voices.find((voice) => voice.id === selectedVoiceId);
  const voiceAsset = selectedVoice
    ? snapshot?.assets.find((asset) => asset.id === selectedVoice.refAssetId)
    : undefined;
  const promptValue = String(values.prompt ?? values.text ?? "");
  const mentionedVoices = model.endpoint === seedAudioEndpoint ? findMentionedTargets(promptValue, snapshot?.voices ?? []) : [];
  const mentionVoiceRefs = mentionedVoices
    .map((voice) => {
      const refAsset = snapshot?.assets.find((item) => item.id === voice.refAssetId);
      return refAsset ? { name: voice.name, url: refAsset.url, duration: refAsset.duration } : undefined;
    })
    .filter((ref): ref is MentionVoiceRef & { duration: number } => Boolean(ref));
  // Cast = the selected voice (if the model needs one) plus every @mentioned voice, deduped, in order.
  const castVoiceRefs = [
    ...(model.needsVoice && selectedVoice && voiceAsset
      ? [{ name: selectedVoice.name, url: voiceAsset.url, duration: voiceAsset.duration }]
      : []),
    ...mentionVoiceRefs.filter((ref) => !(voiceAsset && ref.url === voiceAsset.url))
  ].slice(0, 3);
  const voiceNames = castVoiceRefs.length
    ? castVoiceRefs.map((ref) => ref.name)
    : selectedVoice
      ? [selectedVoice.name]
      : [];
  const voiceKey = castVoiceRefs.length ? castVoiceRefs.map((ref) => ref.name).join("|") : selectedVoice?.id ?? "";
  const promptEnhanceMatches =
    promptEnhance.modelId === model.id && promptEnhance.raw === promptValue && promptEnhance.voiceKey === voiceKey;
  const needsPromptEnhance = Boolean(model.enhancesPrompt && values.enhance !== false && promptValue.trim());
  const promptEnhanceReady = Boolean(
    needsPromptEnhance &&
      promptEnhanceMatches &&
      promptEnhance.enhanced &&
      promptEnhance.status === "done"
  );
  const promptEnhanceFailed = Boolean(needsPromptEnhance && promptEnhanceMatches && promptEnhance.status === "error");
  const enhanced = model.enhancesPrompt
    ? promptEnhanceReady
      ? promptEnhance.enhanced
      : promptValue
    : promptValue;
  const promptIsEnhancing = Boolean(needsPromptEnhance && !promptEnhanceReady && !promptEnhanceFailed);
  const lint = lintPrompt(model.id, enhanced || promptValue);
  const tickInterval = pxPerSecond >= 36 ? 5 : 10;
  const rulerTicks = Array.from(
    { length: Math.max(Math.ceil((Math.max(totalDuration, 40) + tickInterval) / tickInterval), 5) },
    (_, index) => index * tickInterval
  );
  const timelineSelectionHasClip = Boolean(
    timelineSelection &&
      snapshot?.clips.some(
        (clip) =>
          clip.trackId === timelineSelection.trackId &&
          clip.start < timelineSelection.end &&
          clip.start + clip.duration > timelineSelection.start
      )
  );
  const normalizedQuery = assetQuery.trim().toLowerCase();
  const filteredAssets = snapshot
    ? snapshot.assets.filter((asset) => {
        if (projectFilter === "voices") return false;
        if (projectFilter !== "all" && asset.source !== projectFilter) return false;
        if (!normalizedQuery) return true;
        return `${asset.name} ${asset.source} ${asset.derivedFrom?.operation ?? ""}`.toLowerCase().includes(normalizedQuery);
      })
    : [];
  const filteredVoices = snapshot
    ? snapshot.voices.filter((voice) => {
        if (projectFilter !== "all" && projectFilter !== "voices") return false;
        if (!normalizedQuery) return true;
        return voice.name.toLowerCase().includes(normalizedQuery);
      })
    : [];
  const selectedClipTranscript = selectedClipAsset?.transcriptSegments ?? [];
  const whisperBlockedForSelectedClip = selectedClipAsset
    ? isWhisperBlockedAsset(selectedClipAsset, snapshot?.modelRuns ?? [])
    : false;
  const canTranscribeSelectedClip = Boolean(selectedClip && selectedClipAsset && !whisperBlockedForSelectedClip);
  const selectedSourceClip = selectedRegionClip();
  const sourceContextClip = selectedSourceClip ?? selectedClip;
  const activeSpeakerBlocks = activeSpeaker ? visibleSpeakerBlocks(activeSpeaker) : [];
  const missingRequiredField = visibleSchemaFields(model.id).find((field) => {
    if (!field.required || field.clientOnly) return false;
    const value = values[field.name];
    return value === undefined || value === null || value === "";
  });
  const runDisabledReason = promptIsEnhancing
    ? "Prompt enhancer is still running."
    : promptEnhanceFailed
      ? "Prompt enhancer failed. Disable Enhance or fix model credentials."
      : lint.blocked
        ? lint.warnings[0] ?? "Prompt blocked."
        : missingRequiredField
          ? `${missingRequiredField.label} is required.`
          : model.needsSource && (!selectedClip || !selectedClipAsset)
            ? "Select a source clip or region."
            : model.needsRegion && !timelineSelectionHasClip
              ? "Select a timeline region."
              : model.needsVoice && (!selectedVoice || !voiceAsset)
                ? "Select a voice reference."
                : "";

  React.useEffect(() => {
    if (!model.enhancesPrompt || values.enhance === false || !promptValue.trim()) {
      setPromptEnhance({ modelId: model.id, raw: promptValue, voiceKey, enhanced: promptValue, status: "idle" });
      return;
    }

    const controller = new AbortController();
    setPromptEnhance({
      modelId: model.id,
      raw: promptValue,
      voiceKey,
      enhanced: "",
      status: "enhancing",
      source: undefined
    });

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/prompts/enhance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ modelId: model.id, raw: promptValue, voiceNames }),
          signal: controller.signal
        });
        const data = (await response.json()) as {
          enhanced?: string;
          source?: "llm";
          error?: string;
        };
        if (!response.ok || !data.enhanced) throw new Error(data.error ?? "prompt enhancement failed");
        setPromptEnhance({
          modelId: model.id,
          raw: promptValue,
          voiceKey,
          enhanced: data.enhanced,
          status: "done",
          source: "llm",
          error: data.error
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setPromptEnhance({
          modelId: model.id,
          raw: promptValue,
          voiceKey,
          enhanced: "",
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [model.id, model.enhancesPrompt, promptValue, voiceKey, values.enhance]);

  function addTrack(kind: TrackKind, insertAt?: number) {
    patchTracks((tracks) =>
      addTrackOp(tracks, {
        id: uid("track"),
        projectId: snapshot!.project.id,
        kind,
        insertAt
      })
    );
    setAddTrackMenuOpen(false);
    setMenu(null);
    setStatus(`[TRACK ADDED] ${kind.toUpperCase()}`);
  }

  function renameTrack(trackId: string, name: string) {
    patchTracks((tracks) => renameTrackOp(tracks, trackId, name));
  }

  function renameAsset(assetId: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    patchSnapshot((current) => ({
      ...current,
      assets: current.assets.map((asset) => (asset.id === assetId ? { ...asset, name: clean } : asset))
    }));
  }

  function renameVoice(voiceId: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    patchSnapshot((current) => ({
      ...current,
      voices: current.voices.map((voice) => (voice.id === voiceId ? { ...voice, name: clean } : voice))
    }));
  }

  function beginRenameAsset(assetId: string) {
    setSelectedAssetId(assetId);
    setRenaming({ kind: "asset", id: assetId });
  }

  function deleteVoice(voiceId: string) {
    patchSnapshot((current) => ({ ...current, voices: current.voices.filter((voice) => voice.id !== voiceId) }));
    if (selectedVoiceId === voiceId) setSelectedVoiceId("");
    setStatus("[VOICE DELETED]");
  }

  function deleteAsset(asset: Asset) {
    if (!window.confirm(`Delete asset "${asset.name}"?`)) return;
    if (previewAssetId === asset.id) stopPreview();
    patchSnapshot((current) => ({ ...current, assets: current.assets.filter((item) => item.id !== asset.id) }));
    if (selectedAssetId === asset.id) setSelectedAssetId("");
    setStatus("[ASSET DELETED]");
  }

  function openMenu(position: { clientX: number; clientY: number }, items: MenuItem[]) {
    setMenu({ x: position.clientX, y: position.clientY, items });
  }

  function assetMenuItems(asset: Asset): MenuItem[] {
    const usedByClips = snapshot?.clips.some((clip) => clip.assetId === asset.id) ?? false;
    const usedByVoices = snapshot?.voices.some((voice) => voice.refAssetId === asset.id) ?? false;
    return [
      { label: "Add to timeline", onSelect: () => addAssetToTimeline(asset) },
      { label: "Rename", onSelect: () => beginRenameAsset(asset.id) },
      { label: "Save as voice", onSelect: () => saveAssetAsVoice(asset) },
      {
        label: "Inspect asset",
        onSelect: () => {
          setSelectedAssetId(asset.id);
          inspectorRef.current?.scrollIntoView({ block: "nearest" });
        }
      },
      {
        label: "Delete asset",
        danger: true,
        disabled: usedByClips || usedByVoices,
        hint: usedByClips ? "In use on timeline" : usedByVoices ? "In use by a voice" : undefined,
        onSelect: () => deleteAsset(asset)
      }
    ];
  }

  function insertVoiceMention(voice: Voice) {
    const fields = visibleSchemaFields(model.id);
    const fieldName = fields.some((field) => field.name === "prompt")
      ? "prompt"
      : fields.some((field) => field.name === "text")
        ? "text"
        : "";
    if (!fieldName) {
      setStatus(`[ERROR] ${model.label} has no prompt field`);
      return;
    }
    const currentText = String(values[fieldName] ?? "");
    const glue = !currentText || /\s$/.test(currentText) ? "" : " ";
    setField(fieldName, `${currentText}${glue}@${voice.name} `);
    setStatus(`[MENTION] @${voice.name} added to prompt`);
  }

  const promptFieldName = (() => {
    const fields = visibleSchemaFields(model.id);
    return fields.some((field) => field.name === "prompt")
      ? "prompt"
      : fields.some((field) => field.name === "text")
        ? "text"
        : "";
  })();

  function voiceMenuItems(voice: Voice): MenuItem[] {
    const refAsset = snapshot?.assets.find((asset) => asset.id === voice.refAssetId);
    return [
      { label: "Select voice", onSelect: () => setSelectedVoiceId(voice.id) },
      {
        label: "Mention in prompt",
        disabled: model.endpoint !== seedAudioEndpoint,
        hint: model.endpoint !== seedAudioEndpoint ? "Seed models only" : undefined,
        onSelect: () => insertVoiceMention(voice)
      },
      { label: "Rename", onSelect: () => setRenaming({ kind: "voice", id: voice.id }) },
      {
        label: "Preview",
        disabled: !refAsset,
        onSelect: () => refAsset && togglePreview(refAsset)
      },
      { label: "Delete voice", danger: true, onSelect: () => deleteVoice(voice.id) }
    ];
  }

  function clipMenuItems(clip: Clip): MenuItem[] {
    return [
      { label: "Split at playhead (S)", onSelect: () => splitClipAtPlayhead(clip.id) },
      { label: "Duplicate clip", onSelect: () => duplicateClip(clip.id) },
      { label: "Rename", onSelect: () => beginRenameAsset(clip.assetId) },
      { label: "Save clip as asset", onSelect: () => void saveSelectionAsAsset() },
      { label: "Save as voice", onSelect: () => void saveSelectionAsVoice() },
      {
        label: "Transcribe",
        disabled: !canTranscribeSelectedClip,
        onSelect: () => void transcribeSelection()
      },
      { label: "Select clip", onSelect: () => setSelectedClipId(clip.id) },
      { label: "Delete clip", danger: true, onSelect: () => deleteClip(clip.id) }
    ];
  }

  function trackMenuItems(track: Track): MenuItem[] {
    return [
      { label: "Rename track", onSelect: () => setRenamingTrackId(track.id) },
      { label: "Duplicate track", onSelect: () => duplicateTrack(track.id) },
      { label: `Add ${track.kind.toUpperCase()} above`, onSelect: () => addTrack(track.kind, track.order) },
      { label: `Add ${track.kind.toUpperCase()} below`, onSelect: () => addTrack(track.kind, track.order + 1) },
      { label: "Delete track", danger: true, onSelect: () => deleteTrack(track.id) }
    ];
  }

  function laneMenuItems(trackId: string, seconds: number): MenuItem[] {
    return [
      {
        label: selectedAsset ? `Add "${selectedAsset.name.slice(0, 24)}" here` : "Add selected asset here",
        disabled: !selectedAsset,
        onSelect: () => selectedAsset && addAssetToTimeline(selectedAsset, trackId, seconds)
      },
      { label: "Fit zoom", onSelect: zoomFit }
    ];
  }

  function setTrackGain(trackId: string, gain: number) {
    patchTracks((tracks) => setTrackGainOp(tracks, trackId, gain));
  }

  function toggleMute(trackId: string) {
    patchTracks((tracks) => toggleTrackMute(tracks, trackId));
  }

  function toggleSolo(trackId: string) {
    patchTracks((tracks) => toggleTrackSolo(tracks, trackId));
  }

  function moveTrack(trackId: string, direction: -1 | 1) {
    patchTracks((tracks) => moveTrackOp(tracks, trackId, direction));
  }

  function duplicateTrack(trackId: string) {
    patchSnapshot((current) => {
      const next = duplicateTrackOp(
        { tracks: current.tracks, clips: current.clips },
        trackId,
        { trackId: uid("track"), clipId: () => uid("clip") }
      );
      return { ...current, tracks: next.tracks, clips: next.clips };
    });
    setMenu(null);
    setStatus("[TRACK DUPLICATED]");
  }

  function deleteTrack(trackId: string) {
    if (!snapshot) return;
    const clipCount = snapshot.clips.filter((clip) => clip.trackId === trackId).length;
    if (clipCount > 0 && !window.confirm(`Delete this track and ${clipCount} clip(s)? Assets stay in the library.`)) return;

    patchSnapshot((current) => {
      const next = deleteTrackOp({ tracks: current.tracks, clips: current.clips }, trackId);
      return { ...current, tracks: next.tracks, clips: next.clips };
    });
    if (timelineSelection?.trackId === trackId) setTimelineSelection(null);
    setSelectedClipId((current) => {
      const selected = snapshot.clips.find((clip) => clip.id === current);
      return selected?.trackId === trackId ? "" : current;
    });
    setMenu(null);
    setStatus("[TRACK DELETED]");
  }

  function selectModel(nextId: string) {
    const next = getModel(nextId) ?? modelCatalog[0];
    setSelectedModelId(next.id);
    setValues(defaultsFor(next));
    setStatus(`[MODEL] ${next.label}`);
    setRunState({ status: "idle", label: "Ready" });
  }

  function setField(name: string, value: string | number | boolean) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function useRecommendedModel() {
    const routed = routeModelForPrompt(promptValue);
    selectModel(routed.id);
  }

  async function uploadAsset(file: File | null) {
    if (!file || !snapshot) return;
    if (!file.type.startsWith("audio/")) {
      setStatus("[ERROR] audio files only");
      return;
    }
    setStatus(`[IMPORT] uploading ${file.name}`);
    const url = await storeBlob(file, file.name);
    const duration = await audioDuration(url);
    const asset: Asset = {
      id: uid("asset"),
      projectId: snapshot.project.id,
      kind: "audio",
      name: file.name,
      url,
      duration,
      source: "upload",
      createdAt: now()
    };
    patchSnapshot((current) => ({
      ...current,
      assets: [asset, ...current.assets],
      project: { ...current.project, updatedAt: now() }
    }));
    setSelectedAssetId(asset.id);
    setStatus(url.startsWith("data:") ? "[IMPORTED] stored locally (fal upload unavailable)" : "[IMPORTED]");
  }

  async function uploadFieldFile(field: ModelSchemaField, file: File) {
    const wantsImage = field.name.includes("image");
    if (wantsImage && !file.type.startsWith("image/")) {
      setStatus("[ERROR] image files only");
      return;
    }
    if (!wantsImage && !file.type.startsWith("audio/")) {
      setStatus("[ERROR] audio files only");
      return;
    }
    setStatus(`[UPLOAD] ${file.name}`);
    try {
      const url = await uploadToStorage(file);
      setField(field.name, url);
      setStatus("[UPLOADED]");
    } catch (error) {
      setStatus(`[ERROR] ${error instanceof Error ? error.message : "upload failed"}`);
    }
  }

  async function importDroppedFiles(files: File[]) {
    for (const file of files) {
      if (file.type.startsWith("audio/")) {
        await uploadAsset(file);
        continue;
      }
      if (file.type.startsWith("image/")) {
        const imageField = visibleSchemaFields(model.id).find(
          (field) => field.type === "url" && field.name.includes("image")
        );
        if (!imageField) {
          setStatus(`[ERROR] ${model.label} takes no image input`);
          continue;
        }
        await uploadFieldFile(imageField, file);
        continue;
      }
      setStatus(`[ERROR] unsupported file: ${file.name}`);
    }
  }

  function addAssetToTimeline(asset: Asset, trackId?: string, start?: number) {
    if (!snapshot) return;
    if (asset.kind !== "audio") {
      setStatus("[ERROR] audio assets only");
      return;
    }
    const targetTrackId = trackId ?? firstTrack(snapshot, model.defaultTrack ?? "voice");
    const duration = Math.max(asset.duration || 8, 1);
    const clip: Clip = {
      id: uid("clip"),
      trackId: targetTrackId,
      assetId: asset.id,
      start:
        start !== undefined
          ? snapSecond(start)
          : placeWithoutOverlap(snapshot.clips, targetTrackId, Math.ceil(totalDuration), duration),
      duration,
      offset: 0,
      gain: 1,
      fadeIn: 0,
      fadeOut: 0
    };
    patchSnapshot((current) => ({ ...current, clips: [...current.clips, clip] }));
    setSelectedClipId(clip.id);
    setPlayhead(clip.start);
  }

  function patchClip(clipId: string, updater: (clip: Clip) => Clip) {
    patchSnapshot((current) => ({
      ...current,
      clips: current.clips.map((clip) => (clip.id === clipId ? updater(clip) : clip))
    }));
  }

  // Auto-duck: level every music/sfx clip to sit a fixed dB UNDER the voice, measured
  // from the audio using the shared cinematic loudness formula.
  async function autoDuckMix() {
    if (!snapshot) return;
    setStatus("[MIX] measuring loudness");
    const trackKind = new Map(snapshot.tracks.map((t) => [t.id, t.kind]));
    const assetUrl = new Map(snapshot.assets.map((a) => [a.id, a.url]));
    const level = new Map<string, number>();
    await Promise.all(
      [...new Set(snapshot.clips.map((c) => c.assetId))].map(async (id) => {
        const url = assetUrl.get(id);
        if (!url) return;
        const measured = await measureLevel(url);
        if (measured != null && measured > 0) level.set(id, measured);
      })
    );
    const voiceLevel = median(
      snapshot.clips.filter((c) => trackKind.get(c.trackId) === "voice").map((c) => level.get(c.assetId) ?? 0)
    );
    if (!voiceLevel) {
      setStatus("[MIX] add a voice track to duck the beds under");
      return;
    }
    const bedClips = snapshot.clips.filter((c) => {
      const kind = trackKind.get(c.trackId);
      return (kind === "music" || kind === "sfx") && level.has(c.assetId);
    });
    patchSnapshot((current) => ({
      ...current,
      clips: current.clips.map((clip) => {
        const kind = trackKind.get(clip.trackId);
        const bed = level.get(clip.assetId);
        if ((kind === "music" || kind === "sfx") && bed) {
          return { ...clip, gain: duckGain(voiceLevel, bed, DUCK_DB[kind]) };
        }
        return clip;
      })
    }));
    setStatus(`[MIX] ducked ${bedClips.length} bed clip(s) under the voice`);
  }

  // Full auto: brief → LLM plans the spec → run the whole cinematic pipeline (clone +
  // duck + arc) → drop the finished piece on a NEW project. Used by the Cinematic panel.
  async function generateCinematic(
    brief: string,
    characters: ComposeCharacter[],
    onProgress: (p: CinematicProgress) => void,
    signal: AbortSignal
  ) {
    try {
      if (!snapshot) throw new Error("Project is not ready");
      const cast = resolveComposeCast(characters, snapshot.voices, snapshot.assets);
      setStatus("[CINEMATIC] planning");
      const response = await fetch("/api/cinematic/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, characterNames: cast.map((character) => character.name) }),
        signal
      });
      const data = (await response.json().catch(() => null)) as { spec?: CinematicSpec; error?: string } | null;
      if (!response.ok || !data?.spec) throw new Error(data?.error ?? "planning failed");
      const projectId = uid("project");
      const snap = await runCinematic(data.spec, projectId, {
        onProgress: (p) => {
          onProgress(p);
          setStatus(`[CINEMATIC] ${p.phase} ${p.total ? `${p.done}/${p.total}` : ""}`);
        },
        signal,
        cast
      });
      await addProject(snap);
      setStatus(`[CINEMATIC] "${snap.project.name}" ready`);
    } catch (error) {
      if (signal.aborted) {
        setStatus("[CINEMATIC] cancelled");
      } else {
        setStatus(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }
  }

  function secondsFromLane(event: React.DragEvent<HTMLElement> | PointerEvent, lane: HTMLElement): number {
    const rect = lane.getBoundingClientRect();
    return snapSecond((event.clientX - rect.left + lane.scrollLeft) / pxPerSecond);
  }

  function beginClipEdit(
    event: React.PointerEvent<HTMLElement>,
    clip: Clip,
    asset: Asset | undefined,
    mode: "move" | "trim-start" | "trim-end"
  ) {
    if (event.button !== 0 || !asset) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedClipId(clip.id);
    setSelectedAssetId(clip.assetId);

    const startX = event.clientX;
    const original = clip;
    const assetDuration = asset.duration || original.offset + original.duration;
    const snapEdges = snapshot
      ? [
          0,
          playhead,
          ...snapshot.clips
            .filter((item) => item.trackId === clip.trackId && item.id !== clip.id)
            .flatMap((item) => [item.start, item.start + item.duration])
        ]
      : [];
    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) / pxPerSecond;
      const threshold = moveEvent.altKey ? 0 : 8 / pxPerSecond;
      patchClip(clip.id, () => {
        if (mode === "trim-start") {
          const trimmed = trimClipStartBy(original, assetDuration, delta);
          if (!threshold) return trimmed;
          const snapped = snapStart(trimmed.start, 0, snapEdges, threshold);
          return trimClipStartBy(original, assetDuration, delta + (snapped - trimmed.start));
        }
        if (mode === "trim-end") {
          const trimmed = trimClipEndBy(original, assetDuration, delta);
          if (!threshold) return trimmed;
          const end = trimmed.start + trimmed.duration;
          const snappedEnd = snapStart(end, 0, snapEdges, threshold);
          return trimClipEndBy(original, assetDuration, delta + (snappedEnd - end));
        }
        const moved = moveClipBy(original, delta);
        if (!threshold) return moved;
        return { ...moved, start: snapStart(moved.start, moved.duration, snapEdges, threshold) };
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setStatus(mode === "move" ? "[CLIP MOVED]" : "[CLIP TRIMMED]");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function selectRegionOnTrack(trackId: string, nextRegion: Region) {
    if (!snapshot) return;
    const clip = snapshot.clips
      .filter((item) => item.trackId === trackId)
      .find((item) => item.start < nextRegion.end && item.start + item.duration > nextRegion.start);

    if (!clip) {
      setTimelineSelection({ trackId, ...nextRegion });
      setRegion(nextRegion);
      setSelectedClipId("");
      setStatus("[REGION SELECTED]");
      return;
    }

    const clamped = {
      start: snapSecond(Math.max(nextRegion.start, clip.start)),
      end: snapSecond(Math.min(nextRegion.end, clip.start + clip.duration))
    };
    setTimelineSelection({ trackId, ...clamped });
    setRegion(clamped);
    setSelectedClipId(clip.id);
    setSelectedAssetId(clip.assetId);
    setStatus("[REGION READY]");
  }

  function beginRegionSelect(event: React.PointerEvent<HTMLElement>, trackId: string) {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".clip")) return;
    event.preventDefault();
    const lane = event.currentTarget;
    const start = secondsFromLane(event.nativeEvent, lane);
    setTimelineSelection({ trackId, start, end: start });

    const onMove = (moveEvent: PointerEvent) => {
      const end = secondsFromLane(moveEvent, lane);
      setTimelineSelection({ trackId, ...orderedRegion(start, end) });
    };
    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const end = secondsFromLane(upEvent, lane);
      const nextRegion = orderedRegion(start, end);
      if (nextRegion.end - nextRegion.start < 0.1) {
        // Plain click (no drag): move the playhead instead of selecting.
        setTimelineSelection(null);
        seekTimeline(start);
        return;
      }
      selectRegionOnTrack(trackId, nextRegion);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function focusGenerate() {
    const field = generatePanelRef.current?.querySelector<HTMLElement>("textarea, input");
    field?.focus();
  }

  function useRegionModel(modelId: string) {
    const next = getModel(modelId);
    if (!next) return;
    selectModel(next.id);
    focusGenerate();
    if (timelineSelection) setStatus(`[REGION] ${next.label}`);
  }

  function selectTranscriptSegment(segment: TranscriptSegment) {
    if (!selectedClip) {
      setStatus("[ERROR] select a timeline clip for this transcript");
      return;
    }
    const next = assetSegmentToTimelineRegion(selectedClip, segment);
    if (!next) {
      setStatus("[ERROR] transcript segment is outside the visible clip");
      return;
    }
    setTimelineSelection({ trackId: selectedClip.trackId, ...next });
    setRegion(next);
    setStatus(`[SEGMENT] ${segment.speaker ?? "Speaker"} ${next.start.toFixed(2)}-${next.end.toFixed(2)}s`);
  }

  function visibleSpeakerBlocks(speaker: string) {
    return speakerBlocksFor(selectedClip, selectedClipTranscript, speaker);
  }

  function selectSpeakerContext(speaker: string) {
    if (!selectedClip || !selectedClipAsset) {
      setStatus("[ERROR] select a transcript clip first");
      return undefined;
    }
    const block = visibleSpeakerBlocks(speaker)[0];
    if (!block) {
      setStatus("[ERROR] no visible speaker blocks");
      return undefined;
    }
    setActiveSpeaker(speaker);
    setTimelineSelection({ trackId: selectedClip.trackId, ...block.timelineRegion });
    setRegion(block.timelineRegion);
    setSelectedClipId(selectedClip.id);
    setSelectedAssetId(selectedClipAsset.id);
    setStatus(`[SPEAKER] ${speaker} ${block.timelineRegion.start.toFixed(2)}-${block.timelineRegion.end.toFixed(2)}s`);
    return block;
  }

  function exportCaptions(format: "srt" | "vtt") {
    const segments = selectedClipAsset?.transcriptSegments ?? [];
    if (!segments.length) {
      setStatus("[ERROR] transcribe first to export captions");
      return;
    }
    const text = format === "srt" ? toSrt(segments) : toVtt(segments);
    const base = (selectedClipAsset?.name ?? "captions").replace(/\.[a-z0-9]+$/i, "");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${base}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`[CAPTIONS] ${format.toUpperCase()} exported`);
  }

  function splitBySpeaker() {
    if (!selectedClip || !selectedClipAsset) {
      setStatus("[ERROR] select a transcribed clip first");
      return;
    }
    const segments = selectedClipAsset.transcriptSegments ?? [];
    const speakers = Array.from(new Set(segments.map((seg) => seg.speaker).filter((s): s is string => Boolean(s))));
    if (!speakers.length) {
      setStatus("[ERROR] no diarized speakers — transcribe first");
      return;
    }
    const newTracks: Track[] = [];
    const newClips: Clip[] = [];
    speakers.forEach((speaker, speakerIndex) => {
      const trackId = uid("track");
      newTracks.push({
        id: trackId,
        projectId: snapshot!.project.id,
        kind: "voice",
        name: `Speaker: ${speaker}`,
        gain: 1,
        muted: false,
        solo: false,
        order: snapshot!.tracks.length + speakerIndex
      });
      for (const seg of segments.filter((item) => item.speaker === speaker)) {
        const timelineRegion = assetSegmentToTimelineRegion(selectedClip, seg);
        if (!timelineRegion) continue;
        const sourceRegion = regionToSourceSeconds(selectedClip, timelineRegion);
        newClips.push({
          id: uid("clip"),
          trackId,
          assetId: selectedClipAsset.id,
          start: timelineRegion.start,
          duration: Math.max(0.05, timelineRegion.end - timelineRegion.start),
          offset: sourceRegion.start,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0
        });
      }
    });
    if (!newClips.length) {
      setStatus("[ERROR] speaker segments fall outside the clip");
      return;
    }
    patchSnapshot((current) => ({
      ...current,
      tracks: normalizeTrackOrder([...current.tracks, ...newTracks]),
      clips: [...current.clips, ...newClips]
    }));
    setStatus(`[SPLIT] ${speakers.length} speaker lane(s)`);
  }

  function dubSelectedSegment() {
    if (!selectedClip || !timelineSelectionHasClip) {
      setStatus("[ERROR] select a transcript segment or region first");
      return;
    }
    selectModel("seed-dub");
    setStatus("[DUB] segment sent to Dubbing — pick a language and Run");
  }

  async function saveActiveSpeakerAsVoice() {
    if (!selectedClip || !selectedClipAsset || !activeSpeaker) return;
    // Use the longest visible block as the reference — a 3s "yeah" clones poorly.
    const blocks = [...visibleSpeakerBlocks(activeSpeaker)].sort(
      (a, b) => b.sourceRegion.end - b.sourceRegion.start - (a.sourceRegion.end - a.sourceRegion.start)
    );
    const block = blocks[0] ?? selectSpeakerContext(activeSpeaker);
    if (!block) return;
    setActiveSpeaker(activeSpeaker);
    const refClip: Clip = {
      ...selectedClip,
      start: 0,
      offset: block.sourceRegion.start,
      duration: block.sourceRegion.end - block.sourceRegion.start
    };
    setStatus("[VOICE REF] rendering speaker block");
    const refAsset = await renderClipAsset(refClip, selectedClipAsset, "voice-speaker");
    patchSnapshot((current) => ({ ...current, assets: [refAsset, ...current.assets] }));
    createVoiceFromAsset(refAsset);
  }

  function useActiveSpeakerModel(modelId: string) {
    if (!activeSpeaker) return;
    const block = selectSpeakerContext(activeSpeaker);
    if (!block) return;
    useRegionModel(modelId);
  }

  function playTranscriptSpeaker(speaker: string) {
    if (!selectedClip || !selectedClipAsset) {
      setStatus("[ERROR] select a transcript clip first");
      return;
    }
    setActiveSpeaker(speaker);
    const blocks = visibleSpeakerBlocks(speaker);

    if (!blocks.length) {
      setStatus("[ERROR] no visible speaker blocks");
      return;
    }

    stopTimeline(false);
    const audios: HTMLAudioElement[] = [];
    const timers: number[] = [];
    let delay = 0;

    blocks.forEach((block, index) => {
      const duration = Math.max(0.05, block.sourceRegion.end - block.sourceRegion.start);
      const audio = new Audio(selectedClipAsset.url);
      audio.preload = "auto";
      audios.push(audio);
      const startTimer = window.setTimeout(() => {
        setPlayhead(block.timelineRegion.start);
        setTimelineSelection({ trackId: selectedClip.trackId, ...block.timelineRegion });
        setRegion(block.timelineRegion);
        try {
          audio.currentTime = block.sourceRegion.start;
        } catch {
          // Browser may reject early seeks before metadata on remote files.
        }
        void audio.play().catch((error) => {
          setStatus(`[ERROR] ${error instanceof Error ? error.message : "speaker playback failed"}`);
        });
        const stopTimer = window.setTimeout(() => {
          audio.pause();
          setPlayhead(block.timelineRegion.end);
          if (index === blocks.length - 1) {
            setTransportStatus("stopped");
            setStatus("[SPEAKER DONE]");
          }
        }, duration * 1000);
        playbackRef.current.timers.push(stopTimer);
      }, delay * 1000);
      timers.push(startTimer);
      delay += duration;
    });

    playbackRef.current = { audios, timers };
    setTransportStatus("playing");
    setStatus(`[SPEAKER] ${speaker}`);
  }

  function cutSelectedRegionToGap() {
    if (!snapshot || !selectedClip || !timelineSelection || timelineSelection.trackId !== selectedClip.trackId) {
      setStatus("[ERROR] select a region inside a clip");
      return;
    }
    const nextClips = cutClipRegionToGap(selectedClip, timelineSelection, () => uid("clip"));
    patchSnapshot((current) => ({
      ...current,
      clips: current.clips.flatMap((clip) => (clip.id === selectedClip.id ? nextClips : [clip]))
    }));
    setSelectedClipId(nextClips[0]?.id ?? "");
    setTimelineSelection(null);
    setStatus("[GAP CUT]");
  }

  function deleteClip(clipId: string) {
    patchSnapshot((current) => ({
      ...current,
      clips: current.clips.filter((clip) => clip.id !== clipId)
    }));
    if (selectedClipId === clipId) setSelectedClipId("");
    setMenu(null);
    setStatus("[CLIP DELETED]");
  }

  function duplicateClip(clipId: string) {
    if (!snapshot) return;
    const clip = snapshot.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const copy: Clip = {
      ...clip,
      id: uid("clip"),
      start: placeWithoutOverlap(snapshot.clips, clip.trackId, clip.start + clip.duration, clip.duration)
    };
    patchSnapshot((current) => ({ ...current, clips: [...current.clips, copy] }));
    setSelectedClipId(copy.id);
    setMenu(null);
    setStatus("[CLIP DUPLICATED]");
  }

  function splitClipAtPlayhead(clipId: string) {
    if (!snapshot) return;
    const clip = snapshot.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const parts = splitClipAt(clip, playhead, () => uid("clip"));
    if (parts.length < 2) {
      setStatus("[ERROR] move the playhead inside the clip to split");
      setMenu(null);
      return;
    }
    patchSnapshot((current) => ({
      ...current,
      clips: current.clips.flatMap((item) => (item.id === clip.id ? parts : [item]))
    }));
    setSelectedClipId(parts[0].id);
    setMenu(null);
    setStatus("[CLIP SPLIT]");
  }

  function saveAssetAsVoice(asset: Asset) {
    createVoiceFromAsset(asset);
    setMenu(null);
  }

  function stopPreview() {
    const audio = previewRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    previewRef.current = null;
    setPreviewAssetId("");
  }

  function engagePlayer() {
    stopPreview();
    if (transportStatus === "playing") stopTimeline(false);
  }

  function togglePreview(asset: Asset) {
    if (previewAssetId === asset.id) {
      stopPreview();
      return;
    }
    if (transportStatus === "playing") stopTimeline(false);
    playerPauseRef.current?.();
    stopPreview();
    const audio = new Audio(asset.url);
    audio.preload = "auto";
    audio.onended = () => stopPreview();
    previewRef.current = audio;
    setPreviewAssetId(asset.id);
    void audio.play().catch((error) => {
      setStatus(`[ERROR] ${error instanceof Error ? error.message : "preview failed"}`);
      stopPreview();
    });
  }

  function stopTimeline(reset = true) {
    stopPreview();
    playGenRef.current += 1; // cancels a playTimeline still waiting on its buffer
    const active = playbackRef.current;
    active.timers.forEach((timer) => window.clearTimeout(timer));
    if (active.raf) window.cancelAnimationFrame(active.raf);
    active.audios.forEach((audio) => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    });
    playbackRef.current = { audios: [], timers: [] };
    setTransportStatus(reset ? "stopped" : "paused");
    if (reset) setPlayhead(0);
  }

  function pauseTimeline() {
    stopTimeline(false);
    setStatus("[PAUSED]");
  }

  function seekTimeline(next: number) {
    const clamped = Math.max(0, Math.min(next, Math.max(totalDuration, 0)));
    const wasPlaying = transportStatus === "playing";
    stopTimeline(false);
    setPlayhead(clamped);
    if (wasPlaying) window.setTimeout(() => playTimeline(clamped), 0);
  }

  async function playTimeline(from = playhead) {
    if (!snapshot || snapshot.clips.length === 0) {
      setStatus("[ERROR] timeline empty");
      return;
    }
    playerPauseRef.current?.();
    stopTimeline(false);
    const generation = ++playGenRef.current;
    const startAt = Math.min(from, Math.max(totalDuration, 0));
    const audios: HTMLAudioElement[] = [];
    const mix: NonNullable<typeof playbackRef.current.mix> = [];
    const plan: Array<{ audio: HTMLAudioElement; delay: number; playableDuration: number; seekTo: number }> = [];

    for (const clip of snapshot.clips) {
      const asset = snapshot.assets.find((item) => item.id === clip.assetId);
      const track = snapshot.tracks.find((item) => item.id === clip.trackId);
      const clipEnd = clip.start + clip.duration;
      // Muted/soloed-out clips are scheduled too (at volume 0) so mute/solo
      // toggles apply live in the tick instead of requiring a restart.
      if (!asset || !track || clipEnd <= startAt) continue;

      const localOffset = Math.max(0, startAt - clip.start);
      const delay = Math.max(0, clip.start - startAt);
      const entry: PlaybackClipRef = {
        trackId: clip.trackId,
        gain: clip.gain,
        start: clip.start,
        end: clipEnd,
        fadeIn: clip.fadeIn,
        fadeOut: clip.fadeOut
      };
      const audio = new Audio(asset.url);
      // Staged loading: dozens of eager WAV fetches saturate the per-host connection
      // pool and nothing ever buffers. Only imminent clips load now; the rest warm
      // ~8s before their slot via a timer below.
      audio.preload = "none";
      audio.volume = playbackClipVolume(entry, snapshot.tracks, Math.max(startAt, clip.start));
      audios.push(audio);
      mix.push({ audio, ...entry });
      plan.push({ audio, delay, playableDuration: clip.duration - localOffset, seekTo: clip.offset + localOffset });
    }

    // Visible to stopTimeline while we buffer, so stop/seek during buffering tears down.
    playbackRef.current = { audios, timers: [], mix };
    const warmAhead = 8;
    const imminent = plan.filter((item) => item.delay < warmAhead);
    for (const item of imminent) {
      item.audio.preload = "auto";
      item.audio.load();
    }
    const first = imminent.length ? imminent.reduce((a, b) => (a.delay <= b.delay ? a : b)) : null;
    if (first && first.audio.readyState < 3) {
      setStatus("[BUFFERING]");
      setTransportStatus("playing");
      await new Promise<void>((resolve) => {
        const cap = window.setTimeout(finish, 12000); // play anyway after 12s
        function finish() {
          first!.audio.removeEventListener("canplay", finish);
          window.clearTimeout(cap);
          resolve();
        }
        first.audio.addEventListener("canplay", finish);
      });
      if (playGenRef.current !== generation) return; // stopped/seeked while buffering
    }

    const performanceStart = performance.now() - startAt * 1000;
    const timers: number[] = [];
    for (const item of plan) {
      if (item.delay >= warmAhead) {
        timers.push(
          window.setTimeout(() => {
            item.audio.preload = "auto";
            item.audio.load();
          }, (item.delay - warmAhead) * 1000)
        );
      }
      const startTimer = window.setTimeout(() => {
        try {
          item.audio.currentTime = item.seekTo;
        } catch {
          // Some remote files do not allow seeking before metadata. Play from 0.
        }
        void item.audio.play().catch((error) => {
          setStatus(`[ERROR] ${error instanceof Error ? error.message : "playback failed"}`);
        });
        const stopTimer = window.setTimeout(() => item.audio.pause(), item.playableDuration * 1000);
        playbackRef.current.timers.push(stopTimer);
      }, item.delay * 1000);
      timers.push(startTimer);
    }

    function tick() {
      const current = Math.min((performance.now() - performanceStart) / 1000, totalDuration);
      setPlayhead(current);
      const tracksNow = tracksLiveRef.current;
      for (const entry of playbackRef.current.mix ?? []) {
        entry.audio.volume = playbackClipVolume(entry, tracksNow, current);
      }
      if (current >= totalDuration) {
        // ponytail: always loop — the preview workflow wants repeat; add a toggle if stop-at-end is ever needed
        playTimelineRef.current(0);
        return;
      }
      playbackRef.current.raf = window.requestAnimationFrame(tick);
    }

    playbackRef.current = { audios, timers, mix, raf: window.requestAnimationFrame(tick) };
    setTransportStatus("playing");
    setStatus("[PLAYING]");
  }
  playTimelineRef.current = playTimeline;
  tracksLiveRef.current = snapshot?.tracks ?? [];

  async function renderClipAsset(clip: Clip, asset: Asset, operation = "clip-render"): Promise<Asset> {
    const blob = await renderClipToWav({ asset, clip, sampleRate: snapshot!.project.sampleRate });
    const cleanName = asset.name.replace(/\.[a-z0-9]+$/i, "");
    return {
      id: uid("asset"),
      projectId: snapshot!.project.id,
      kind: "audio",
      name: `${cleanName} clip ${clip.offset.toFixed(1)}-${(clip.offset + clip.duration).toFixed(1)}s`,
      url: await storeBlob(blob, `${cleanName}-clip.wav`),
      duration: clip.duration,
      source: "derived",
      derivedFrom: {
        assetId: asset.id,
        modelId: "timeline",
        operation,
        params: {
          clipId: clip.id,
          offset: clip.offset,
          duration: clip.duration,
          sourceStart: clip.offset,
          sourceEnd: clip.offset + clip.duration
        }
      },
      createdAt: now()
    };
  }

  function selectedRegionClip(): Clip | undefined {
    return regionClipFor(selectedClip, timelineSelection);
  }

  async function sourceForClip(clip: Clip, asset: Asset): Promise<{ url: string; clipLocal: boolean }> {
    if (!clipUsesEditedSource(clip, asset)) return { url: asset.url, clipLocal: false };
    setStatus("[SOURCE] rendering selected clip");
    const blob = await renderClipToWav({
      asset,
      clip,
      sampleRate: snapshot!.project.sampleRate
    });
    return { url: await storeBlob(blob, "clip-source.wav"), clipLocal: true };
  }

  function createVoiceFromAsset(refAsset: Asset) {
    const voice: Voice = {
      id: uid("voice"),
      projectId: snapshot!.project.id,
      name: refAsset.name.replace(/\.[a-z0-9]+$/i, ""),
      refAssetId: refAsset.id,
      provider: "local",
      createdAt: now()
    };
    patchSnapshot((current) => ({ ...current, voices: [voice, ...current.voices] }));
    setSelectedVoiceId(voice.id);
    setStatus(`[VOICE SAVED] mention it as @${voice.name}`);
  }

  async function saveSelectionAsAsset(): Promise<Asset | undefined> {
    if (!snapshot || !selectedClip || !selectedClipAsset) {
      setStatus("[ERROR] select a clip or region first");
      return undefined;
    }

    const regionClip = selectedRegionClip();
    const clip = regionClip ?? selectedClip;
    setStatus(regionClip ? "[ASSET] rendering region" : "[ASSET] rendering clip");
    const asset = await renderClipAsset(clip, selectedClipAsset, regionClip ? "region-extract" : "clip-render");
    patchSnapshot((current) => ({ ...current, assets: [asset, ...current.assets] }));
    setSelectedAssetId(asset.id);
    setStatus("[ASSET SAVED]");
    return asset;
  }

  async function saveSelectionAsVoice() {
    if (!snapshot || (!selectedAsset && !selectedClipAsset)) {
      setStatus("[ERROR] select an audio asset, clip, or region first");
      return;
    }
    const baseAsset = selectedClipAsset ?? selectedAsset;
    if (!baseAsset || baseAsset.kind !== "audio") return;

    const refClip = selectedRegionClip() ?? selectedClip;
    setStatus(refClip && selectedClipAsset && clipUsesEditedSource(refClip, selectedClipAsset) ? "[VOICE REF] rendering clip" : "[VOICE REF] using asset");
    const refAsset =
      refClip && selectedClipAsset && clipUsesEditedSource(refClip, selectedClipAsset)
        ? await renderClipAsset(refClip, selectedClipAsset, selectedRegionClip() ? "voice-region" : "voice-clip")
        : baseAsset;
    patchSnapshot((current) => ({
      ...current,
      assets: refAsset.id === baseAsset.id ? current.assets : [refAsset, ...current.assets]
    }));
    createVoiceFromAsset(refAsset);
  }

  async function buildInput(): Promise<Record<string, unknown> | undefined> {
    if (!snapshot) return undefined;
    if (model.id === "whisper-asr") {
      if (selectedClipAsset && isWhisperBlockedAsset(selectedClipAsset, snapshot.modelRuns)) {
        setStatus("[ERROR] Whisper disabled for generated music/SFX");
        return undefined;
      }
    }

    let source:
      | {
          url: string;
          clipLocal: boolean;
          sourceOffset: number;
          duration?: number;
        }
      | undefined;
    if (model.needsSource) {
      if (!selectedClip || !selectedClipAsset) {
        setStatus("[ERROR] select a source clip");
        return undefined;
      }
      let sourceClip = model.needsRegion ? selectedClip : selectedRegionClip() ?? selectedClip;
      // Extend only needs the most recent voice/topic context — window a long source to its
      // trailing ~28s instead of rejecting it. Placement still continues after the full source.
      if (model.id === "seed-extend" && sourceClip.duration > seedReferenceMaxSeconds - 2) {
        sourceClip = trailingWindow(sourceClip, seedReferenceMaxSeconds - 2);
        setStatus("[EXTEND] using the last 28s as voice context");
      }
      if (model.endpoint === seedAudioEndpoint && sourceClip.duration > seedReferenceMaxSeconds) {
        const message = `Seed Audio V1 needs a source region under ${seedReferenceMaxSeconds}s. Select a shorter region.`;
        setStatus(`[ERROR] ${message}`);
        setRunState({ status: "error", label: "Source too long", error: message });
        return undefined;
      }
      const prepared = await sourceForClip(sourceClip, selectedClipAsset);
      source = {
        url: prepared.url,
        clipLocal: prepared.clipLocal,
        sourceOffset: prepared.clipLocal ? sourceClip.offset : 0,
        duration: sourceClip.duration
      };
    }

    if (model.needsVoice) {
      if (!selectedVoice || !voiceAsset) {
        setStatus("[ERROR] select a voice");
        return undefined;
      }
      if (model.endpoint === seedAudioEndpoint && voiceAsset.duration > seedReferenceMaxSeconds) {
        const message = `Seed Audio V1 needs a voice reference under ${seedReferenceMaxSeconds}s. Save a shorter region as voice.`;
        setStatus(`[ERROR] ${message}`);
        setRunState({ status: "error", label: "Voice reference too long", error: message });
        return undefined;
      }
    }

    const longMentionRef = mentionVoiceRefs.find((ref) => ref.duration > seedReferenceMaxSeconds);
    if (model.endpoint === seedAudioEndpoint && longMentionRef) {
      const message = `@${longMentionRef.name} reference is over ${seedReferenceMaxSeconds}s. Save a shorter region as that voice.`;
      setStatus(`[ERROR] ${message}`);
      setRunState({ status: "error", label: "Mentioned voice too long", error: message });
      return undefined;
    }

    const built = buildModelRunInput({
      model,
      values,
      enhanced,
      source,
      selectedClip,
      region,
      selectedVoice,
      voiceAsset,
      mentionVoices: mentionVoiceRefs
    });
    if (built.errors.length) {
      setStatus(`[ERROR] ${built.errors[0]}`);
      setRunState({ status: "error", label: "Invalid model input", error: built.errors[0] });
      return undefined;
    }
    return built.input;
  }

  async function submitModelJob(
    targetModel: ModelDefinition,
    input: Record<string, unknown>,
    sourceAssetIds: string[]
  ): Promise<Job | undefined> {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modelId: targetModel.id,
        operation: targetModel.task,
        input: publicInput(input),
        sourceAssetIds
      })
    });
    const data = (await response.json()) as { job?: Job; error?: string };
    if (!response.ok || !data.job) {
      setStatus(`[ERROR] ${data.error ?? "job failed"}`);
      setRunState({ status: "error", label: "Job rejected", error: data.error ?? "job failed" });
      return undefined;
    }
    let job = data.job;
    const startedAt = Date.now();
    while (job.status !== "done" && job.status !== "error") {
      if (Date.now() - startedAt > 5 * 60_000) {
        setStatus("[ERROR] job timed out");
        setRunState({ status: "error", label: "Job timed out", jobId: job.id, error: "no result after 5 minutes" });
        return undefined;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const pollResponse = await fetch(`/api/jobs/${job.id}`);
      if (!pollResponse.ok) {
        setStatus("[ERROR] job lost");
        setRunState({ status: "error", label: "Job lost", jobId: job.id, error: "job not found — dev server may have restarted" });
        return undefined;
      }
      const pollData = (await pollResponse.json()) as { job?: Job };
      if (!pollData.job) continue;
      job = pollData.job;
      const logLine = job.logs[job.logs.length - 1];
      setRunState((current) => ({ ...current, jobId: job.id, progress: job.progress, logLine }));
    }
    return job;
  }

  function saveTranscriptToAsset(assetId: string, output: ModelOutput | undefined, sourceOffset = 0) {
    if (!output) return;
    const transcript = offsetTranscript(
      {
        transcript: output.transcript,
        transcriptSegments: output.transcriptSegments,
        diarizationSegments: output.diarizationSegments
      },
      sourceOffset
    );
    patchSnapshot((current) => ({
      ...current,
      assets: current.assets.map((asset) =>
        asset.id === assetId
          ? {
              ...asset,
              transcript: transcript.transcript ?? asset.transcript,
              transcriptSegments: transcript.transcriptSegments ?? asset.transcriptSegments,
              diarizationSegments: transcript.diarizationSegments ?? asset.diarizationSegments
            }
          : asset
      )
    }));
  }

  async function transcribeSelection() {
    if (!snapshot || !selectedClip || !selectedClipAsset) {
      setStatus("[ERROR] select a clip or region first");
      return;
    }
    if (isWhisperBlockedAsset(selectedClipAsset, snapshot.modelRuns)) {
      setStatus("[ERROR] Whisper disabled for generated music/SFX");
      setRunState({ status: "error", label: "Whisper disabled for generated music/SFX" });
      return;
    }
    const asr = getModel("whisper-asr");
    if (!asr) return;
    const sourceClip = selectedRegionClip() ?? selectedClip;
    setStatus("[ASR] preparing diarized transcript");
    setRunState({ status: "submitting", label: "Submitting transcript job" });
    const source = await sourceForClip(sourceClip, selectedClipAsset);
    const input: Record<string, unknown> = {
      audio_url: source.url,
      source_audio_url: source.url,
      task: "transcribe",
      diarize: true,
      chunk_level: "segment"
    };
    const job = await submitModelJob(asr, input, [selectedClipAsset.id]);
    if (!job) return;
    if (job.status !== "done") {
      patchSnapshot((current) => ({ ...current, jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)] }));
      setRunState({ status: "error", label: "Transcript failed", jobId: job.id, error: job.error });
      setStatus("[ERROR] transcript failed");
      return;
    }
    const sourceOffset = source.clipLocal ? sourceClip.offset : 0;
    saveTranscriptToAsset(selectedClipAsset.id, job.outputs[0], sourceOffset);
    const stamp = now();
    patchSnapshot((current) => ({
      ...current,
      jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)],
      modelRuns: [
        {
          id: uid("run"),
          jobId: job.id,
          modelId: asr.id,
          operation: asr.task,
          input,
          outputAssetIds: [selectedClipAsset.id],
          createdAt: stamp
        },
        ...current.modelRuns
      ]
    }));
    setRunState({ status: "done", label: "Transcript attached", jobId: job.id });
    setStatus("[TRANSCRIBED]");
  }

  async function runModel() {
    if (!snapshot) return;
    setRunState({ status: "validating", label: "Validating input" });
    if (promptIsEnhancing) {
      setRunState({ status: "error", label: "Prompt enhancer still running" });
      return;
    }
    if (promptEnhanceFailed) {
      setStatus("[ERROR] prompt enhancer failed");
      setRunState({ status: "error", label: "Prompt enhancer failed", error: promptEnhance.error });
      return;
    }
    if (lint.blocked) {
      setStatus("[ERROR] prompt blocked by lint");
      setRunState({ status: "error", label: "Prompt blocked", error: lint.warnings[0] });
      return;
    }
    const input = await buildInput();
    if (!input) {
      setRunState({ status: "error", label: "Missing required selection" });
      return;
    }

    setStatus("[RUNNING]");
    setRunState({ status: "submitting", label: "Submitting model job" });
    const sourceAssetIds = selectedClipAsset ? [selectedClipAsset.id] : [];
    const sourceOffset = Number(input.__source_offset_s ?? 0);
    const job = await submitModelJob(model, input, sourceAssetIds);
    if (!job) return;

    const stamp = now();
    const requestedDuration = requestedOutputDuration(input);
    if (model.task === "asr" && selectedClipAsset) {
      if (job.status !== "done") {
        patchSnapshot((current) => ({ ...current, jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)] }));
        setStatus("[ERROR] transcript failed");
        setRunState({ status: "error", label: "Transcript failed", jobId: job.id, error: job.error });
        return;
      }
      saveTranscriptToAsset(selectedClipAsset.id, job.outputs[0], sourceOffset);
      patchSnapshot((current) => ({
        ...current,
        jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)],
        modelRuns: [
          {
            id: uid("run"),
            jobId: job.id,
            modelId: model.id,
            operation: model.task,
            input: publicInput(input),
            outputAssetIds: [selectedClipAsset.id],
            createdAt: stamp
          },
          ...current.modelRuns
        ]
      }));
      setStatus("[TRANSCRIBED]");
      setRunState({ status: "done", label: "Transcript attached", jobId: job.id });
      return;
    }

    // Variations: fire the job N times and stack the takes (seed-nudged when the model exposes a seed).
    const takeCount = Math.max(1, Math.min(3, Number(values.variations) || 1));
    const extraOutputs: ModelOutput[] = [];
    if (takeCount > 1 && job.status === "done") {
      for (let take = 1; take < takeCount; take += 1) {
        setRunState({ status: "submitting", label: `Rendering take ${take + 1}/${takeCount}`, jobId: job.id });
        const takeInput = typeof input.seed === "number" ? { ...input, seed: input.seed + take } : input;
        const takeJob = await submitModelJob(model, takeInput, sourceAssetIds);
        if (takeJob?.status === "done") extraOutputs.push(...takeJob.outputs.filter((output) => output.url));
      }
    }
    const jobOutputs = [...job.outputs, ...extraOutputs];

    const createdAssets = jobOutputs.filter((output) => output.url).map((output, index): Asset => {
      if (model.kind === "transform" && selectedClipAsset) {
        return createDerivedAsset(selectedClipAsset, {
          id: uid("asset"),
          url: output.url!,
          duration: output.duration || selectedClipAsset.duration || requestedDuration,
          modelId: model.id,
          operation: model.task,
          params: input,
          jobId: job.id,
          createdAt: stamp
        });
      }
      return {
        id: uid("asset"),
        projectId: snapshot.project.id,
        kind: "audio",
        trackKind: model.defaultTrack,
        name: `${buildOutputName(model, input)}${index ? ` ${index + 1}` : ""}`,
        url: output.url!,
        duration: output.duration || requestedDuration,
        source: "generated",
        transcript: output.transcript,
        transcriptSegments: output.transcriptSegments,
        diarizationSegments: output.diarizationSegments,
        createdAt: stamp
      };
    });

    // Auto-trim: analyze each output for leading/trailing silence so clips land on the
    // audible window. The asset keeps the full audio — handles pull the silence back.
    // Inpaint and dub are exempt: their placement/duration contracts need the raw timing.
    const trimExempt = model.task === "inpaint" || model.task === "dub";
    const windows = new Map<string, AudibleWindow | null | undefined>();
    if (!trimExempt && job.status === "done") {
      setRunState({ status: "submitting", label: "Checking outputs for silence", jobId: job.id });
      await Promise.all(
        createdAssets.map(async (asset) => {
          windows.set(asset.id, await audibleWindow(asset.url));
        })
      );
    }
    let cutSeconds = 0;
    let silentOutputs = 0;

    const createdClips: Clip[] = [];
    const newTracks: Track[] = [];
    // Inpaint replaces in place: the source clip is split at the gap (asset untouched).
    let replacedSourceParts: Clip[] | null = null;
    if (model.kind === "transform" && selectedClip) {
      const sourceTrack = snapshot.tracks.find((track) => track.id === selectedClip.trackId);
      const sourceTrackKind = sourceTrack?.kind ?? "voice";
      const hasRegion = Boolean(selectedRegionClip());
      const placedAgainst = [...snapshot.clips];
      const trackByLabel = new Map<string, string>();
      for (const asset of createdAssets) {
        const trim = trimPlan(windows.get(asset.id), asset.duration || selectedClip.duration);
        if (trim.silent) {
          silentOutputs += 1;
          continue; // asset stays in Project media; a fully silent clip helps nobody
        }
        cutSeconds += trim.cut;
        const plan = planTransformPlacement({
          operation: model.task,
          sourceClipStart: selectedClip.start,
          sourceClipDuration: selectedClip.duration,
          sourceTrackKind,
          regionStart: hasRegion ? region.start : null,
          regionEnd: hasRegion ? region.end : null,
          outputDuration: trim.cut > 0 ? trim.duration : asset.duration || selectedClip.duration,
          gapStart: Number(input.gap_start_s),
          gapEnd: Number(input.gap_end_s),
          languageLabel: model.task === "dub" ? String(values.target_language ?? "") : undefined,
          crossfade: model.task === "inpaint" ? 0.02 : 0
        });

        if (plan.mode === "replace-region" && !replacedSourceParts) {
          // Split the source clip around the gap and drop the repair between the halves.
          replacedSourceParts = cutClipRegionToGap(
            selectedClip,
            { start: plan.start, end: plan.start + plan.duration },
            () => uid("clip")
          );
          const created: Clip = {
            id: uid("clip"),
            trackId: selectedClip.trackId,
            assetId: asset.id,
            start: plan.start,
            duration: plan.duration,
            offset: plan.offset + trim.offset,
            gain: 1,
            fadeIn: plan.fadeIn,
            fadeOut: plan.fadeOut
          };
          createdClips.push(created);
          continue;
        }

        let trackId: string;
        if (plan.mode === "same-track-after") {
          trackId = selectedClip.trackId;
        } else {
          const label = plan.trackLabel ?? "Take";
          let laneId = trackByLabel.get(label);
          if (!laneId) {
            const existing = [...snapshot.tracks, ...newTracks].find((track) => track.name === label);
            if (existing) {
              laneId = existing.id;
            } else {
              laneId = uid("track");
              newTracks.push({
                id: laneId,
                projectId: snapshot.project.id,
                kind: plan.trackKind,
                name: label,
                gain: 1,
                // Takes are ALTERNATIVES to the source — born muted so they don't
                // stack over the original; unmute/solo the lane to compare.
                muted: true,
                solo: false,
                // Fractional order sorts the lane directly BELOW the source track;
                // normalizeTrackOrder reassigns integers afterwards.
                order: (sourceTrack?.order ?? snapshot.tracks.length) + 0.5 + newTracks.length * 0.001
              });
            }
            trackByLabel.set(label, laneId);
          }
          trackId = laneId;
        }
        const start = placeWithoutOverlap(placedAgainst, trackId, plan.start, plan.duration);
        const created: Clip = {
          id: uid("clip"),
          trackId,
          assetId: asset.id,
          start,
          duration: plan.duration,
          offset: plan.offset + trim.offset,
          gain: 1,
          fadeIn: plan.fadeIn,
          fadeOut: plan.fadeOut
        };
        createdClips.push(created);
        placedAgainst.push(created);
      }
    } else if (model.kind === "generate" && createdAssets.length) {
      // Generate outputs drop at the playhead on the model's default lane instead of the far end.
      const targetTrackId = firstTrack(snapshot, model.defaultTrack ?? "voice");
      const placedAgainst = [...snapshot.clips];
      let desiredStart = snapSecond(playhead);
      for (const asset of createdAssets) {
        const trim = trimPlan(windows.get(asset.id), Math.max(asset.duration || 8, 1));
        if (trim.silent) {
          silentOutputs += 1;
          continue;
        }
        cutSeconds += trim.cut;
        const duration = Math.max(trim.duration, 1);
        const start = placeWithoutOverlap(placedAgainst, targetTrackId, desiredStart, duration);
        const created: Clip = {
          id: uid("clip"),
          trackId: targetTrackId,
          assetId: asset.id,
          start,
          duration,
          offset: trim.offset,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0
        };
        createdClips.push(created);
        placedAgainst.push(created);
        desiredStart = start + duration;
      }
    }

    // Auto-duck (the cinematic-audio workflow, in-app): a newly generated music/SFX bed
    // is leveled to sit under the existing voice via the loudness formula. Only the new
    // bed's gain is set — existing clips are untouched. No voice present → left at 1.
    const kindOf = (trackId: string) =>
      newTracks.find((track) => track.id === trackId)?.kind ?? snapshot.tracks.find((track) => track.id === trackId)?.kind;
    const newBeds = createdClips.filter((clip) => {
      const kind = kindOf(clip.trackId);
      return kind === "music" || kind === "sfx";
    });
    if (newBeds.length) {
      const voiceUrls = [
        ...new Set(
          snapshot.clips
            .filter((clip) => kindOf(clip.trackId) === "voice")
            .map((clip) => snapshot.assets.find((asset) => asset.id === clip.assetId)?.url)
            .filter((url): url is string => Boolean(url))
        )
      ];
      const voiceLevels = (await Promise.all(voiceUrls.map((url) => measureLevel(url)))).filter(
        (level): level is number => typeof level === "number" && level > 0
      );
      const voiceLevel = median(voiceLevels);
      if (voiceLevel) {
        await Promise.all(
          newBeds.map(async (clip) => {
            const asset = createdAssets.find((item) => item.id === clip.assetId);
            const bedLevel = asset?.url ? await measureLevel(asset.url) : null;
            if (bedLevel) clip.gain = duckGain(voiceLevel, bedLevel, DUCK_DB[kindOf(clip.trackId) as "music" | "sfx"]);
          })
        );
      }
    }

    patchSnapshot((current) => ({
      ...current,
      tracks: newTracks.length ? normalizeTrackOrder([...current.tracks, ...newTracks]) : current.tracks,
      assets: [...createdAssets, ...current.assets],
      clips: [
        ...current.clips.flatMap((clip) =>
          replacedSourceParts && selectedClip && clip.id === selectedClip.id ? replacedSourceParts : [clip]
        ),
        ...createdClips
      ],
      jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)],
      promptDrafts:
        model.enhancesPrompt && promptValue
          ? [
              {
                id: uid("prompt"),
                modelId: model.id,
                raw: promptValue,
                enhanced,
                warnings: lint.warnings,
                createdAt: stamp
              },
              ...current.promptDrafts
            ]
          : current.promptDrafts,
      modelRuns: [
        {
          id: uid("run"),
          jobId: job.id,
          modelId: model.id,
          operation: model.task,
          input: publicInput(input),
          outputAssetIds: createdAssets.map((asset) => asset.id),
          createdAt: stamp
        },
        ...current.modelRuns
      ]
    }));
    if (createdClips[0]) setSelectedClipId(createdClips[0].id);
    if (createdAssets[0]) setSelectedAssetId(createdAssets[0].id);
    setStatus(job.status === "done" ? "[DONE]" : "[ERROR]");
    if (job.status === "done" && silentOutputs) {
      setStatus(`[ERROR] ${silentOutputs} output(s) fully silent — clip skipped, asset kept in Project`);
    } else if (job.status === "done") {
      const notes: string[] = [];
      if (cutSeconds > 0.05) notes.push(`${cutSeconds.toFixed(1)}s silence trimmed`);
      const mutedLane = newTracks.find((track) => track.muted);
      if (mutedLane) notes.push(`take on muted "${mutedLane.name}" lane — unmute or solo to compare`);
      if (notes.length) setStatus(`[DONE] ${notes.join(" / ")}`);
    }
    setRunState({
      status: job.status === "done" ? "done" : "error",
      label: job.status === "done" ? "Output attached" : "Model failed",
      jobId: job.id,
      error: job.error
    });
    if (model.kind !== "transform" && job.status === "done" && promptValue.trim() && createdAssets.length) {
      void describeGeneratedAssets(
        createdAssets.map((asset) => ({ id: asset.id, placeholder: asset.name })),
        promptValue
      );
    }
  }

  async function describeGeneratedAssets(targets: Array<{ id: string; placeholder: string }>, prompt: string) {
    try {
      const response = await fetch("/api/assets/describe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      if (!response.ok) return;
      const data = (await response.json()) as { title?: string };
      const title = data.title?.trim();
      if (!title) return;
      patchSnapshot((current) => ({
        ...current,
        assets: current.assets.map((asset) => {
          const index = targets.findIndex((target) => target.id === asset.id);
          // Only replace names the user has not touched since generation.
          if (index === -1 || asset.name !== targets[index].placeholder) return asset;
          return { ...asset, name: index ? `${title} ${index + 1}` : title };
        })
      }));
    } catch {
      // LLM naming is best-effort; the prompt-derived placeholder stays.
    }
  }

  async function exportWav() {
    if (!snapshot || snapshot.clips.length === 0 || exporting) return;
    setStatus("[EXPORTING]");
    setExporting(true);
    try {
      const blob = await renderTimelineToWav({
        assets: snapshot.assets,
        clips: snapshot.clips,
        tracks: snapshot.tracks,
        sampleRate: snapshot.project.sampleRate
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "audio-studio.wav";
      link.click();
      URL.revokeObjectURL(url);
      setStatus("[EXPORTED]");
    } catch (error) {
      setStatus(`[ERROR] ${error instanceof Error ? error.message : "export failed"}`);
    } finally {
      setExporting(false);
    }
  }

  if (!snapshot) {
    return (
      <main className="studio">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">AUDIO</span>
            <small>CREATOR STUDIO V1</small>
          </div>
          <span className="status blink">[LOADING PROJECT]</span>
        </header>
      </main>
    );
  }

  return (
    <AudioPlayerProvider>
    <PlayerBridge pauseRef={playerPauseRef} />
    <main className="studio">
      <StudioTopbar
        projectName={snapshot.project.name}
        projectId={snapshot.project.id}
        projects={projects}
        editingName={editingName}
        status={status}
        saving={saving}
        runState={runState}
        jobs={snapshot.jobs}
        onRenameProject={(name) =>
          patchSnapshot((current) => ({ ...current, project: { ...current.project, name } }))
        }
        onEditNameChange={setEditingName}
        onSwitchProject={(id) => void switchProject(id)}
        onCreateProject={() => void createProject()}
      />

      <div className={`workspace ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}>
        <aside className="panel rail">
          {rightCollapsed ? (
            <button
              className="panel-collapsed-strip"
              type="button"
              title="Expand Project panel (])"
              onClick={() => setRightCollapsed(false)}
            >
              <span>PROJECT</span>
            </button>
          ) : null}
          <div className="rail-stack">
            <ProjectMediaPanel
              assets={snapshot.assets}
              voices={snapshot.voices}
              filteredAssets={filteredAssets}
              filteredVoices={filteredVoices}
              assetQuery={assetQuery}
              projectFilter={projectFilter}
              selectedAsset={selectedAsset}
              selectedAssetId={selectedAssetId}
              selectedVoiceId={selectedVoiceId}
              previewAssetId={previewAssetId}
              renaming={renaming}
              onCollapse={() => setRightCollapsed(true)}
              onQueryChange={setAssetQuery}
              onFilterChange={setProjectFilter}
              onUpload={(file) => void uploadAsset(file)}
              onSelectAsset={setSelectedAssetId}
              onSelectVoice={setSelectedVoiceId}
              onAddToTimeline={addAssetToTimeline}
              onTogglePreview={togglePreview}
              onRenameAsset={renameAsset}
              onRenameVoice={renameVoice}
              onSetRenaming={setRenaming}
              onSaveVoice={saveAssetAsVoice}
              onAssetMenu={(event, asset) => openMenu(event, assetMenuItems(asset))}
              onVoiceMenu={(event, voice) => openMenu(event, voiceMenuItems(voice))}
            />
            <InspectorPanel
              inspectorRef={inspectorRef}
              selectedClip={selectedClip}
              selectedClipAsset={selectedClipAsset}
              selectedAsset={selectedAsset}
              selectedClipTranscript={selectedClipTranscript}
              timelineSelection={timelineSelection}
              timelineSelectionHasClip={timelineSelectionHasClip}
              whisperBlockedForSelectedClip={whisperBlockedForSelectedClip}
              canTranscribeSelectedClip={canTranscribeSelectedClip}
              tracks={snapshot.tracks}
              region={region}
              onSaveAsset={saveSelectionAsAsset}
              onSaveVoiceSelection={saveSelectionAsVoice}
              onTranscribe={transcribeSelection}
              onCutGap={cutSelectedRegionToGap}
              onRegionModel={useRegionModel}
              onDub={dubSelectedSegment}
              onPatchClip={patchClip}
              onRegionChange={setRegion}
              onEngagePlayer={engagePlayer}
              onAddToTimeline={addAssetToTimeline}
              onSaveVoiceAsset={saveAssetAsVoice}
              onExportCaptions={exportCaptions}
              onSplitBySpeaker={splitBySpeaker}
              onPlaySpeaker={playTranscriptSpeaker}
              onSelectSegment={selectTranscriptSegment}
            />
          </div>
        </aside>

        <TimelineView
          tracksRef={tracksRef}
          rulerTicksRef={rulerTicksRef}
          tracks={orderedTracks}
          clips={snapshot.clips}
          assets={snapshot.assets}
          pxPerSecond={pxPerSecond}
          playhead={playhead}
          rulerTicks={rulerTicks}
          tickInterval={tickInterval}
          compactTracks={compactTracks}
          addTrackMenuOpen={addTrackMenuOpen}
          renamingTrackId={renamingTrackId}
          dragOver={dragOver}
          timelineSelection={timelineSelection}
          selectedClipId={selectedClipId}
          menu={menu}
          hasClips={snapshot.clips.length > 0}
          onToggleAddTrackMenu={() => setAddTrackMenuOpen((open) => !open)}
          onAddTrack={addTrack}
          onToggleCompact={() => setCompactTracks((compact) => !compact)}
          onAutoDuck={() => void autoDuckMix()}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomFit={zoomFit}
          onFocusGenerate={focusGenerate}
          onRenameTrack={renameTrack}
          onStartRenameTrack={setRenamingTrackId}
          onStopRenameTrack={() => setRenamingTrackId("")}
          onClearSelection={() => setTimelineSelection(null)}
          onToggleMute={toggleMute}
          onToggleSolo={toggleSolo}
          onMoveTrack={moveTrack}
          onSetTrackGain={setTrackGain}
          onTrackMenu={(event, track) => openMenu(event, trackMenuItems(track))}
          onTrackMenuButton={(track, rect) => setMenu({ x: rect.left, y: rect.bottom + 4, items: trackMenuItems(track) })}
          onLaneMenu={(event, trackId, seconds) => openMenu(event, laneMenuItems(trackId, seconds))}
          onSetDragOver={setDragOver}
          onDropAsset={(assetId, trackId, seconds) => {
            const asset = snapshot.assets.find((item) => item.id === assetId);
            if (asset) addAssetToTimeline(asset, trackId, seconds);
          }}
          onBeginRegionSelect={beginRegionSelect}
          onSelectClip={(clipId, assetId) => {
            setSelectedClipId(clipId);
            setSelectedAssetId(assetId);
          }}
          onClipMenu={(event, clip) => openMenu(event, clipMenuItems(clip))}
          onBeginClipEdit={beginClipEdit}
          onCloseMenu={() => setMenu(null)}
          onSeek={seekTimeline}
        />

        <GeneratePanel
          generatePanelRef={generatePanelRef}
          projectId={snapshot.project.id}
          leftCollapsed={leftCollapsed}
          model={model}
          picker={{
            open: modelPickerOpen,
            query: modelQuery,
            providerFilter: modelProviderFilter,
            taskFilter: modelTaskFilter,
            bestForFilter: modelBestForFilter,
            activeIndex: modelActiveIndex,
            featuredExpanded,
            filteredModels: filteredModelsForPicker,
            providerFilters: modelProviderFilters,
            taskFilters: modelTaskFilters,
            bestForFilters: modelBestForFilters,
            featuredModels,
            groupedModels: groupedPickerModels,
            keyboardModel,
            onToggleOpen: () => setModelPickerOpen((open) => !open),
            onQueryChange: setModelQuery,
            onProviderFilter: setModelProviderFilter,
            onTaskFilter: setModelTaskFilter,
            onBestForFilter: setModelBestForFilter,
            onActiveIndexChange: setModelActiveIndex,
            onToggleFeatured: () => setFeaturedExpanded((expanded) => !expanded),
            onPick: (id) => {
              selectModel(id);
              setModelPickerOpen(false);
            }
          }}
          promptFieldName={promptFieldName}
          timelineSelection={timelineSelection}
          values={values}
          voices={snapshot.voices}
          selectedVoiceId={selectedVoiceId}
          selectedClipAsset={selectedClipAsset}
          sourceContextClip={sourceContextClip}
          selectedSourceClip={selectedSourceClip}
          selectedVoice={selectedVoice}
          voiceAsset={voiceAsset}
          activeSpeaker={activeSpeaker}
          activeSpeakerBlocks={activeSpeakerBlocks}
          runDisabledReason={runDisabledReason}
          promptValue={promptValue}
          enhanced={enhanced}
          promptEnhance={promptEnhance}
          promptEnhanceReady={promptEnhanceReady}
          promptEnhanceFailed={promptEnhanceFailed}
          promptIsEnhancing={promptIsEnhancing}
          lint={lint}
          runState={runState}
          runStateCard={runStateCard}
          latestOutputs={latestOutputs}
          latestRun={latestRun}
          onExpand={() => setLeftCollapsed(false)}
          onCollapse={() => setLeftCollapsed(true)}
          onRoute={useRecommendedModel}
          onSetField={setField}
          onSelectVoice={setSelectedVoiceId}
          onUploadFieldFile={uploadFieldFile}
          onSaveSpeakerVoice={saveActiveSpeakerAsVoice}
          onSpeakerModel={useActiveSpeakerModel}
          onRun={runModel}
          onAddToTimeline={addAssetToTimeline}
          onEngagePlayer={engagePlayer}
          onGenerateBrief={generateCinematic}
        />
      </div>

      <StudioTransport
        playhead={playhead}
        totalDuration={totalDuration}
        transportStatus={transportStatus}
        clipCount={snapshot.clips.length}
        exporting={exporting}
        sampleRate={snapshot.project.sampleRate}
        onSeek={seekTimeline}
        onPlay={() => playTimeline()}
        onPause={pauseTimeline}
        onStop={() => stopTimeline(true)}
        onExport={exportWav}
        onReset={() => {
          if (window.confirm("Reset the local project? All tracks, clips, and assets will be deleted.")) {
            setSnapshot(defaultSnapshot(snapshot.project.id, snapshot.project.name));
          }
        }}
        onSampleRate={(rate) =>
          patchSnapshot((current) => ({ ...current, project: { ...current.project, sampleRate: rate } }))
        }
      />
      <StudioOverlays
        fileDragActive={fileDragActive}
        toast={toast}
        shortcutsOpen={shortcutsOpen}
        onCloseShortcuts={() => setShortcutsOpen(false)}
      />
    </main>
    </AudioPlayerProvider>
  );
}
