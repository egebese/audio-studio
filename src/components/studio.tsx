"use client";

import * as React from "react";
import ProviderIcon from "@lobehub/icons/es/features/ProviderIcon";
import { isWhisperBlockedAsset } from "@/lib/asset-rules";
import { renderClipToWav, renderTimelineToWav } from "@/lib/audio-export";
import { cutClipRegionToGap, moveClipBy, trimClipEndBy, trimClipStartBy } from "@/lib/clip-edit";
import { loadSnapshot, saveSnapshot } from "@/lib/db";
import { createDerivedAsset } from "@/lib/lineage";
import { buildModelRunInput } from "@/lib/model-input";
import { getModel, modelCatalog, routeModelForPrompt, seedAudioEndpoint, type ModelDefinition } from "@/lib/model-catalog";
import { schemaDefaults, visibleSchemaFields, type ModelSchemaField } from "@/lib/model-schemas";
import {
  filterModels,
  groupModelsByProvider,
  lobeProviderIconKey,
  modelBestForOptions,
  modelLettermark,
  modelProviderOptions,
  modelTaskOptions
} from "@/lib/model-picker";
import { lintPrompt } from "@/lib/prompt-intelligence";
import { assetSegmentToTimelineRegion, regionToSourceSeconds } from "@/lib/region";
import {
  addTrack as addTrackOp,
  deleteTrack as deleteTrackOp,
  duplicateTrack as duplicateTrackOp,
  isTrackAudible,
  moveTrack as moveTrackOp,
  normalizeTrackOrder,
  renameTrack as renameTrackOp,
  setTrackGain as setTrackGainOp,
  toggleTrackMute,
  toggleTrackSolo
} from "@/lib/track-ops";
import { offsetTranscript, segmentsForSpeaker, transcriptSpeakerKey } from "@/lib/transcript";
import type { Asset, Clip, Job, ModelOutput, ProjectSnapshot, Region, Track, TrackKind, TranscriptSegment, Voice } from "@/lib/types";

const pxPerSecond = 18;
const seedReferenceMaxSeconds = 30;

type RunStatus = "idle" | "validating" | "submitting" | "done" | "error";
type TransportStatus = "stopped" | "playing" | "paused";
type PromptEnhanceStatus = "idle" | "enhancing" | "done" | "error";
type RightPanelTab = "inspector" | "generate" | "jobs";
type ProjectFilter = "all" | "upload" | "generated" | "derived" | "voices";

interface RunUiState {
  status: RunStatus;
  label: string;
  jobId?: string;
  error?: string;
}

interface PromptEnhanceState {
  modelId: string;
  raw: string;
  voiceKey: string;
  enhanced: string;
  status: PromptEnhanceStatus;
  source?: "llm";
  error?: string;
}

interface ContextMenuState {
  clipId: string;
  x: number;
  y: number;
}

interface TrackContextMenuState {
  trackId: string;
  x: number;
  y: number;
}

interface AssetContextMenuState {
  assetId: string;
  x: number;
  y: number;
}

interface TimelineSelection {
  trackId: string;
  start: number;
  end: number;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

function defaultSnapshot(): ProjectSnapshot {
  const stamp = now();
  const project = {
    id: "project_default",
    name: "Untitled audio system",
    sampleRate: 48000,
    createdAt: stamp,
    updatedAt: stamp
  };
  const tracks: Track[] = [
    { id: "track_voice", projectId: project.id, kind: "voice", name: "Voice", gain: 1, muted: false, solo: false, order: 0 },
    { id: "track_music", projectId: project.id, kind: "music", name: "Music", gain: 0.82, muted: false, solo: false, order: 1 },
    { id: "track_sfx", projectId: project.id, kind: "sfx", name: "SFX", gain: 0.9, muted: false, solo: false, order: 2 }
  ];
  return { project, tracks: normalizeTrackOrder(tracks), clips: [], assets: [], voices: [], jobs: [], promptDrafts: [], modelRuns: [] };
}

function defaultsFor(model: ModelDefinition): Record<string, string | number | boolean> {
  return schemaDefaults(model.id);
}

function firstTrack(snapshot: ProjectSnapshot, kind: Track["kind"] = "voice"): string {
  const tracks = normalizeTrackOrder(snapshot.tracks);
  return tracks.find((track) => track.kind === kind)?.id ?? tracks[0].id;
}

function formatTime(sec: number): string {
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return blobToDataUrl(file);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => resolve(0);
    audio.src = url;
  });
}

function buildOutputName(model: ModelDefinition, input: Record<string, unknown>): string {
  const text = String(input.prompt ?? input.text ?? input.style ?? model.label);
  return text.trim().slice(0, 42) || model.label;
}

function requestedOutputDuration(input: Record<string, unknown>): number {
  const value = Number(input.seconds_total ?? input.duration ?? input.add_seconds);
  return Number.isFinite(value) && value > 0 ? value : 8;
}

function snapSecond(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

function clipUsesEditedSource(clip: Clip, asset: Asset): boolean {
  return clip.offset > 0.05 || clip.duration < Math.max(0, asset.duration - clip.offset) - 0.05;
}

function orderedRegion(a: number, b: number): Region {
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

function FieldEditor({
  model,
  values,
  setValue
}: {
  model: ModelDefinition;
  values: Record<string, string | number | boolean>;
  setValue: (name: string, value: string | number | boolean) => void;
}) {
  return (
    <>
      {visibleSchemaFields(model.id).map((field) => {
        const value = values[field.name] ?? "";
        const commonHelp = field.advanced ? `${field.helper ?? ""}${field.helper ? " " : ""}[ADV]` : field.helper;
        return (
          <label className="field" key={field.name}>
            <span>
              {field.label}
              {field.required ? " *" : ""}
            </span>
            {field.type === "textarea" ? (
              <textarea
                className="textarea"
                value={String(value)}
                onChange={(event) => setValue(field.name, event.target.value)}
              />
            ) : field.type === "enum" ? (
              <select
                className="select"
                value={String(value)}
                onChange={(event) => setValue(field.name, event.target.value)}
              >
                <option value="">Select</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <span className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(event) => setValue(field.name, event.target.checked)}
                />
                  <span className="fine">Enabled</span>
                </span>
            ) : field.type === "json" || field.type === "array" ? (
              <textarea
                className="textarea"
                value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                onChange={(event) => setValue(field.name, event.target.value)}
              />
            ) : (
              <input
                className="input"
                type={field.type === "number" || field.type === "integer" ? "number" : field.type === "url" ? "url" : "text"}
                step={field.type === "integer" ? 1 : undefined}
                value={String(value)}
                onChange={(event) =>
                  setValue(
                    field.name,
                    field.type === "number" || field.type === "integer"
                      ? event.target.value === ""
                        ? ""
                        : Number(event.target.value)
                      : event.target.value
                  )
                }
              />
            )}
            {commonHelp ? <span className="fine">{commonHelp}</span> : null}
          </label>
        );
      })}
    </>
  );
}

function ProviderMark({ model, size = 18 }: { model: ModelDefinition; size?: number }) {
  const iconKey = lobeProviderIconKey(model);
  return (
    <span className="provider-mark" aria-hidden="true">
      {iconKey ? (
        <ProviderIcon provider={iconKey} size={size} type="mono" />
      ) : (
        <span>{modelLettermark(model)}</span>
      )}
    </span>
  );
}

function ModelBadges({ model }: { model: ModelDefinition }) {
  const badges = [
    model.needsSource ? "Source" : undefined,
    model.needsRegion ? "Region" : undefined,
    model.needsVoice ? "Voice" : undefined,
    ...model.capabilities,
    model.durationHint
  ].filter((badge, index, all): badge is string => Boolean(badge) && all.indexOf(badge) === index);

  return (
    <span className="model-badges">
      {badges.slice(0, 6).map((badge) => (
        <span className="pill" key={badge}>{badge}</span>
      ))}
    </span>
  );
}

export function Studio() {
  const [snapshot, setSnapshot] = React.useState<ProjectSnapshot | null>(null);
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
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const [trackContextMenu, setTrackContextMenu] = React.useState<TrackContextMenuState | null>(null);
  const [assetContextMenu, setAssetContextMenu] = React.useState<AssetContextMenuState | null>(null);
  const [addTrackMenuOpen, setAddTrackMenuOpen] = React.useState(false);
  const [compactTracks, setCompactTracks] = React.useState(true);
  const [renamingTrackId, setRenamingTrackId] = React.useState<string>("");
  const [rightTab, setRightTab] = React.useState<RightPanelTab>("generate");
  const [assetQuery, setAssetQuery] = React.useState("");
  const [projectFilter, setProjectFilter] = React.useState<ProjectFilter>("all");
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [modelQuery, setModelQuery] = React.useState("");
  const [modelProviderFilter, setModelProviderFilter] = React.useState("");
  const [modelTaskFilter, setModelTaskFilter] = React.useState("");
  const [modelBestForFilter, setModelBestForFilter] = React.useState("");
  const [activeSpeaker, setActiveSpeaker] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const playbackRef = React.useRef<{
    audios: HTMLAudioElement[];
    timers: number[];
    raf?: number;
  }>({ audios: [], timers: [] });

  React.useEffect(() => {
    let alive = true;
    loadSnapshot()
      .then((saved) => {
        if (alive) setSnapshot(saved ?? defaultSnapshot());
      })
      .catch(() => {
        if (alive) setSnapshot(defaultSnapshot());
      });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!snapshot) return;
    const handle = window.setTimeout(() => {
      setSaving(true);
      saveSnapshot(snapshot).finally(() => setSaving(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [snapshot]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT";
      if (editing) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedClipId) {
        event.preventDefault();
        deleteClip(selectedClipId);
      }
      if (event.code === "Space") {
        event.preventDefault();
        transportStatus === "playing" ? pauseTimeline() : playTimeline();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  React.useEffect(() => {
    function closeMenus() {
      setContextMenu(null);
      setTrackContextMenu(null);
      setAssetContextMenu(null);
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
  const voiceNames = selectedVoice ? [selectedVoice.name] : [];
  const voiceKey = selectedVoice?.id ?? "";
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
  const totalDuration = snapshot ? Math.max(0, ...snapshot.clips.map((clip) => clip.start + clip.duration)) : 0;
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
  const modelProviderFilters = modelProviderOptions(modelCatalog);
  const modelTaskFilters = modelTaskOptions(modelCatalog);
  const modelBestForFilters = modelBestForOptions(modelCatalog);
  const filteredModelsForPicker = filterModels(modelCatalog, {
    query: modelQuery,
    provider: modelProviderFilter,
    task: modelTaskFilter,
    bestFor: modelBestForFilter
  });
  const featuredModels = filteredModelsForPicker.filter((item) => item.featured);
  const groupedPickerModels = groupModelsByProvider(filteredModelsForPicker);

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
  }, [model.id, model.enhancesPrompt, promptValue, selectedVoice?.id, selectedVoice?.name, values.enhance]);

  function patchSnapshot(updater: (current: ProjectSnapshot) => ProjectSnapshot) {
    setSnapshot((current) => (current ? updater(current) : current));
  }

  function patchTracks(updater: (tracks: Track[]) => Track[]) {
    patchSnapshot((current) => ({ ...current, tracks: normalizeTrackOrder(updater(current.tracks)) }));
  }

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
    setTrackContextMenu(null);
    setStatus(`[TRACK ADDED] ${kind.toUpperCase()}`);
  }

  function renameTrack(trackId: string, name: string) {
    patchTracks((tracks) => renameTrackOp(tracks, trackId, name));
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
    setTrackContextMenu(null);
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
    setTrackContextMenu(null);
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
    setStatus("[IMPORT] reading audio");
    const url = await fileToDataUrl(file);
    const duration = await audioDuration(url);
    if (!file.type.startsWith("audio/")) {
      setStatus("[ERROR] audio files only");
      return;
    }
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
    setStatus("[IMPORTED]");
  }

  function addAssetToTimeline(asset: Asset, trackId?: string, start?: number) {
    if (!snapshot) return;
    if (asset.kind !== "audio") {
      setStatus("[ERROR] audio assets only");
      return;
    }
    const targetTrackId = trackId ?? firstTrack(snapshot, model.defaultTrack ?? "voice");
    const clip: Clip = {
      id: uid("clip"),
      trackId: targetTrackId,
      assetId: asset.id,
      start: snapSecond(start ?? Math.ceil(totalDuration)),
      duration: Math.max(asset.duration || 8, 1),
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
    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) / pxPerSecond;
      patchClip(clip.id, () => {
        if (mode === "trim-start") return trimClipStartBy(original, assetDuration, delta);
        if (mode === "trim-end") return trimClipEndBy(original, assetDuration, delta);
        return moveClipBy(original, delta);
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
      if (nextRegion.end - nextRegion.start < 0.1) return;
      selectRegionOnTrack(trackId, nextRegion);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function useRegionModel(modelId: string) {
    const next = getModel(modelId);
    if (!next) return;
    selectModel(next.id);
    setRightTab("generate");
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
    if (!selectedClip) return [];
    return segmentsForSpeaker(selectedClipTranscript, speaker)
      .map((segment) => {
        const timelineRegion = assetSegmentToTimelineRegion(selectedClip, segment);
        if (!timelineRegion) return undefined;
        const sourceRegion = regionToSourceSeconds(selectedClip, timelineRegion);
        return { segment, timelineRegion, sourceRegion };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
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

  async function saveActiveSpeakerAsVoice() {
    if (!selectedClip || !selectedClipAsset || !activeSpeaker) return;
    const block = selectSpeakerContext(activeSpeaker);
    if (!block) return;
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
    setContextMenu(null);
    setStatus("[CLIP DELETED]");
  }

  function duplicateClip(clipId: string) {
    if (!snapshot) return;
    const clip = snapshot.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const copy: Clip = {
      ...clip,
      id: uid("clip"),
      start: clip.start + 0.5
    };
    patchSnapshot((current) => ({ ...current, clips: [...current.clips, copy] }));
    setSelectedClipId(copy.id);
    setContextMenu(null);
    setStatus("[CLIP DUPLICATED]");
  }

  function saveAssetAsVoice(asset: Asset) {
    createVoiceFromAsset(asset);
    setAssetContextMenu(null);
  }

  function stopTimeline(reset = true) {
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

  function playTimeline(from = playhead) {
    if (!snapshot || snapshot.clips.length === 0) {
      setStatus("[ERROR] timeline empty");
      return;
    }
    stopTimeline(false);
    const startAt = Math.min(from, Math.max(totalDuration, 0));
    const performanceStart = performance.now() - startAt * 1000;
    const audios: HTMLAudioElement[] = [];
    const timers: number[] = [];

    for (const clip of snapshot.clips) {
      const asset = snapshot.assets.find((item) => item.id === clip.assetId);
      const track = snapshot.tracks.find((item) => item.id === clip.trackId);
      const clipEnd = clip.start + clip.duration;
      if (!asset || !track || !isTrackAudible(track, snapshot.tracks) || clipEnd <= startAt) continue;

      const localOffset = Math.max(0, startAt - clip.start);
      const delay = Math.max(0, clip.start - startAt);
      const playableDuration = clip.duration - localOffset;
      const audio = new Audio(asset.url);
      audio.preload = "auto";
      audio.volume = Math.max(0, Math.min(1, clip.gain * track.gain));
      audios.push(audio);

      const startTimer = window.setTimeout(() => {
        try {
          audio.currentTime = clip.offset + localOffset;
        } catch {
          // Some remote files do not allow seeking before metadata. Play from 0.
        }
        void audio.play().catch((error) => {
          setStatus(`[ERROR] ${error instanceof Error ? error.message : "playback failed"}`);
        });
        const stopTimer = window.setTimeout(() => audio.pause(), playableDuration * 1000);
        playbackRef.current.timers.push(stopTimer);
      }, delay * 1000);
      timers.push(startTimer);
    }

    function tick() {
      const current = Math.min((performance.now() - performanceStart) / 1000, totalDuration);
      setPlayhead(current);
      if (current >= totalDuration) {
        stopTimeline(false);
        setPlayhead(totalDuration);
        setTransportStatus("stopped");
        setStatus("[STOPPED]");
        return;
      }
      playbackRef.current.raf = window.requestAnimationFrame(tick);
    }

    playbackRef.current = { audios, timers, raf: window.requestAnimationFrame(tick) };
    setTransportStatus("playing");
    setStatus("[PLAYING]");
  }

  async function renderClipAsset(clip: Clip, asset: Asset, operation = "clip-render"): Promise<Asset> {
    const blob = await renderClipToWav({ asset, clip, sampleRate: snapshot!.project.sampleRate });
    return {
      id: uid("asset"),
      projectId: snapshot!.project.id,
      kind: "audio",
      name: `${asset.name.replace(/\.[a-z0-9]+$/i, "")} clip ${clip.offset.toFixed(1)}-${(clip.offset + clip.duration).toFixed(1)}s`,
      url: await blobToDataUrl(blob),
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
    if (!selectedClip || !timelineSelection || timelineSelection.trackId !== selectedClip.trackId) return undefined;
    const range = {
      start: Math.max(timelineSelection.start, selectedClip.start),
      end: Math.min(timelineSelection.end, selectedClip.start + selectedClip.duration)
    };
    if (range.end - range.start < 0.1) return undefined;
    const sourceRegion = regionToSourceSeconds(selectedClip, range);
    return {
      ...selectedClip,
      start: 0,
      offset: sourceRegion.start,
      duration: sourceRegion.end - sourceRegion.start
    };
  }

  async function sourceForClip(clip: Clip, asset: Asset): Promise<{ url: string; clipLocal: boolean }> {
    if (!clipUsesEditedSource(clip, asset)) return { url: asset.url, clipLocal: false };
    setStatus("[SOURCE] rendering selected clip");
    const blob = await renderClipToWav({
      asset,
      clip,
      sampleRate: snapshot!.project.sampleRate
    });
    return { url: await blobToDataUrl(blob), clipLocal: true };
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
    setStatus("[VOICE SAVED]");
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
      const sourceClip = model.needsRegion ? selectedClip : selectedRegionClip() ?? selectedClip;
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

    const built = buildModelRunInput({
      model,
      values,
      enhanced,
      source,
      selectedClip,
      region,
      selectedVoice,
      voiceAsset
    });
    if (built.errors.length) {
      setStatus(`[ERROR] ${built.errors[0]}`);
      setRunState({ status: "error", label: "Invalid model input", error: built.errors[0] });
      return undefined;
    }
    return built.input;
  }

  function publicInput(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(input).filter(([key, value]) => !key.startsWith("__") && value !== "")
    );
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
    return data.job;
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

    const createdAssets = job.outputs.filter((output) => output.url).map((output, index): Asset => {
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

    const createdClips =
      model.kind === "transform" && selectedClip
        ? createdAssets.map((asset): Clip => ({
            id: uid("clip"),
            trackId: selectedClip.trackId,
            assetId: asset.id,
            start: selectedClip.start,
            duration: asset.duration || selectedClip.duration,
            offset: 0,
            gain: 1,
            fadeIn: 0,
            fadeOut: 0
          }))
        : [];

    patchSnapshot((current) => ({
      ...current,
      assets: [...createdAssets, ...current.assets],
      clips: [...current.clips, ...createdClips],
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
    setRunState({
      status: job.status === "done" ? "done" : "error",
      label: job.status === "done" ? "Output attached" : "Model failed",
      jobId: job.id,
      error: job.error
    });
  }

  async function exportWav() {
    if (!snapshot || snapshot.clips.length === 0) return;
    setStatus("[EXPORTING]");
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
    }
  }

  if (!snapshot) {
    return <main className="studio"><div className="topbar">[LOADING]</div></main>;
  }

  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">AUDIO</span>
          <small>CREATOR STUDIO V1</small>
        </div>
        <span className="pill">Audio only</span>
        <span className="pill red">Nothing / OLED</span>
        <span className={`status ${status.includes("ERROR") ? "err" : status.includes("DONE") ? "ok" : ""}`}>
          {saving ? "[SAVING]" : status}
        </span>
      </header>

      <div className="workspace">
        <aside className="panel left">
          <div className="panel-scroll">
            <section className="section project-panel">
              <div className="section-title">
                <h2>Project</h2>
                <span className="pill">{snapshot.assets.length + snapshot.voices.length}</span>
              </div>
              <input
                className="input project-search"
                type="search"
                placeholder="Search media"
                value={assetQuery}
                onChange={(event) => setAssetQuery(event.target.value)}
              />
              <div className="project-filters" role="tablist" aria-label="Project filters">
                {(["all", "upload", "generated", "derived", "voices"] as ProjectFilter[]).map((filter) => (
                  <button
                    key={filter}
                    className={projectFilter === filter ? "active" : ""}
                    type="button"
                    aria-pressed={projectFilter === filter}
                    onClick={() => setProjectFilter(filter)}
                  >
                    {filter}
                  </button>
                ))}
              </div>
              <label className="field compact-field">
                <span>Upload audio</span>
                <input className="input" type="file" accept="audio/*" onChange={(event) => uploadAsset(event.target.files?.[0] ?? null)} />
              </label>
              <div className="asset-list project-list">
                {filteredAssets.map((asset) => (
                  <button
                    type="button"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", asset.id)}
                    className={`asset ${asset.id === selectedAssetId ? "active" : ""}`}
                    key={asset.id}
                    onClick={() => {
                      setSelectedAssetId(asset.id);
                      setRightTab("inspector");
                    }}
                    onDoubleClick={() => addAssetToTimeline(asset)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedAssetId(asset.id);
                      setAssetContextMenu({ assetId: asset.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <span className="asset-kind">{asset.source.slice(0, 3).toUpperCase()}</span>
                    <span className="asset-main">
                      <strong>{asset.name}</strong>
                      <span className="fine">{formatTime(asset.duration || 0)} / {asset.derivedFrom?.operation ?? "source"}</span>
                    </span>
                    <span className="asset-badges">
                      {asset.transcript ? <span className="pill">TXT</span> : null}
                      {asset.derivedFrom ? <span className="pill red">DRV</span> : null}
                    </span>
                  </button>
                ))}
              </div>
              {!filteredAssets.length ? <p className="fine">No matching assets.</p> : null}
            </section>

            {(projectFilter === "all" || projectFilter === "voices") ? (
              <section className="section">
                <div className="section-title">
                  <h2>Voices</h2>
                  <span className="pill">{filteredVoices.length}</span>
                </div>
                <div className="voice-list">
                  {filteredVoices.map((voice) => (
                    <button
                      type="button"
                      className={`voice-row ${voice.id === selectedVoiceId ? "active" : ""}`}
                      key={voice.id}
                      onClick={() => setSelectedVoiceId(voice.id)}
                    >
                      <strong>{voice.name}</strong>
                      <span className="fine">{voice.provider ?? "local"} reference</span>
                    </button>
                  ))}
                </div>
                {!filteredVoices.length ? <p className="fine">No voice references yet.</p> : null}
              </section>
            ) : null}

            <section className="section">
              <div className="button-row">
                <button className="button" type="button" disabled={!selectedAsset} onClick={() => selectedAsset && addAssetToTimeline(selectedAsset)}>
                  Add
                </button>
                <button className="button" type="button" disabled={!selectedAsset} onClick={() => selectedAsset && saveAssetAsVoice(selectedAsset)}>
                  Save Voice
                </button>
              </div>
            </section>
          </div>
        </aside>

        <section className="timeline">
          <div className="timeline-toolbar">
            <div className="timeline-toolbar-title">
              <span className="label">Timeline Tracks</span>
              <strong>{orderedTracks.length}</strong>
            </div>
            <div className="track-add">
              <button
                className="button compact"
                type="button"
                aria-expanded={addTrackMenuOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setAddTrackMenuOpen((open) => !open);
                }}
              >
                + Track
              </button>
              {addTrackMenuOpen ? (
                <div className="track-add-menu" onClick={(event) => event.stopPropagation()}>
                  {(["voice", "music", "sfx"] as TrackKind[]).map((kind) => (
                    <button key={kind} type="button" onClick={() => addTrack(kind)}>
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
              onClick={() => setCompactTracks((compact) => !compact)}
            >
              Compact
            </button>
          </div>
          <div className="ruler">
            <span>0:00</span>
            <span>0:10</span>
            <span>0:20</span>
            <span>0:30</span>
            <span>0:40</span>
          </div>
          <div className={`tracks ${compactTracks ? "compact" : ""}`}>
            {orderedTracks.map((track, index) => (
              <div
                className="track"
                key={track.id}
              >
                <div
                  className={`track-label ${track.muted ? "muted-track" : ""} ${track.solo ? "solo-track" : ""}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setTrackContextMenu({ trackId: track.id, x: event.clientX, y: event.clientY });
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
                        onChange={(event) => renameTrack(track.id, event.target.value)}
                        onBlur={() => setRenamingTrackId("")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === "Escape") setRenamingTrackId("");
                        }}
                      />
                    ) : (
                      <button
                        className="track-name-button"
                        type="button"
                        onDoubleClick={() => setRenamingTrackId(track.id)}
                        onClick={() => setTimelineSelection(null)}
                        title="Double-click to rename"
                      >
                        {track.name}
                      </button>
                    )}
                    <button
                      className="track-menu-button"
                      type="button"
                      aria-label={`Open ${track.name} track menu`}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setTrackContextMenu({ trackId: track.id, x: rect.left, y: rect.bottom + 4 });
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
                      aria-pressed={track.muted}
                      onClick={() => toggleMute(track.id)}
                    >
                      M
                    </button>
                    <button
                      className={`track-toggle ${track.solo ? "active" : ""}`}
                      type="button"
                      aria-label={`Solo ${track.name}`}
                      aria-pressed={track.solo}
                      onClick={() => toggleSolo(track.id)}
                    >
                      S
                    </button>
                    <button
                      className="track-small"
                      type="button"
                      aria-label={`Move ${track.name} up`}
                      disabled={index === 0}
                      onClick={() => moveTrack(track.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="track-small"
                      type="button"
                      aria-label={`Move ${track.name} down`}
                      disabled={index === orderedTracks.length - 1}
                      onClick={() => moveTrack(track.id, 1)}
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
                      onChange={(event) => setTrackGain(track.id, Number(event.target.value))}
                    />
                  </label>
                </div>
                <div
                  className="lane"
                  onPointerDown={(event) => beginRegionSelect(event, track.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const asset = snapshot.assets.find((item) => item.id === event.dataTransfer.getData("text/plain"));
                    if (asset) addAssetToTimeline(asset, track.id, secondsFromLane(event, event.currentTarget));
                  }}
                >
                  <span
                    className="playhead"
                    style={{ left: playhead * pxPerSecond }}
                    aria-hidden="true"
                  />
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
                  {snapshot.clips
                    .filter((clip) => clip.trackId === track.id)
                    .map((clip) => {
                      const asset = snapshot.assets.find((item) => item.id === clip.assetId);
                      return (
                        <button
                          type="button"
                          className={`clip ${clip.id === selectedClipId ? "selected" : ""}`}
                          key={clip.id}
                          style={{ left: clip.start * pxPerSecond, width: Math.max(clip.duration * pxPerSecond, 32) }}
                          onPointerDown={(event) => beginClipEdit(event, clip, asset, "move")}
                          onClick={() => {
                            setSelectedClipId(clip.id);
                            setSelectedAssetId(clip.assetId);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setSelectedClipId(clip.id);
                            setSelectedAssetId(clip.assetId);
                            setContextMenu({ clipId: clip.id, x: event.clientX, y: event.clientY });
                          }}
                        >
                          <span
                            className="clip-handle left"
                            onPointerDown={(event) => beginClipEdit(event, clip, asset, "trim-start")}
                            aria-hidden="true"
                          />
                          <span className="clip-name">{asset?.name ?? "Missing asset"}</span>
                          <span className="wave" />
                          <span
                            className="clip-handle right"
                            onPointerDown={(event) => beginClipEdit(event, clip, asset, "trim-end")}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          {contextMenu ? (
            <div
              className="context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" onClick={() => duplicateClip(contextMenu.clipId)}>Duplicate clip</button>
              <button type="button" onClick={() => {
                void saveSelectionAsAsset();
                setContextMenu(null);
              }}>
                Save clip as asset
              </button>
              <button type="button" onClick={() => {
                void saveSelectionAsVoice();
                setContextMenu(null);
              }}>
                Save as voice
              </button>
              <button type="button" disabled={!canTranscribeSelectedClip} onClick={() => {
                void transcribeSelection();
                setContextMenu(null);
              }}>
                Transcribe
              </button>
              <button type="button" onClick={() => {
                setSelectedClipId(contextMenu.clipId);
                setContextMenu(null);
              }}>
                Select clip
              </button>
              <button className="danger" type="button" onClick={() => deleteClip(contextMenu.clipId)}>
                Delete clip
              </button>
            </div>
          ) : null}
          {trackContextMenu ? (() => {
            const track = snapshot.tracks.find((item) => item.id === trackContextMenu.trackId);
            if (!track) return null;
            return (
              <div
                className="context-menu track-context-menu"
                style={{ left: trackContextMenu.x, top: trackContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button type="button" onClick={() => {
                  setRenamingTrackId(track.id);
                  setTrackContextMenu(null);
                }}>
                  Rename track
                </button>
                <button type="button" onClick={() => duplicateTrack(track.id)}>Duplicate track</button>
                <button type="button" onClick={() => addTrack(track.kind, track.order)}>Add {track.kind.toUpperCase()} above</button>
                <button type="button" onClick={() => addTrack(track.kind, track.order + 1)}>Add {track.kind.toUpperCase()} below</button>
                <button className="danger" type="button" onClick={() => deleteTrack(track.id)}>
                  Delete track
                </button>
              </div>
            );
          })() : null}
          {assetContextMenu ? (() => {
            const asset = snapshot.assets.find((item) => item.id === assetContextMenu.assetId);
            if (!asset) return null;
            return (
              <div
                className="context-menu asset-context-menu"
                style={{ left: assetContextMenu.x, top: assetContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button type="button" onClick={() => {
                  addAssetToTimeline(asset);
                  setAssetContextMenu(null);
                }}>
                  Add to timeline
                </button>
                <button type="button" onClick={() => saveAssetAsVoice(asset)}>
                  Save as voice
                </button>
                <button type="button" onClick={() => {
                  setSelectedAssetId(asset.id);
                  setRightTab("inspector");
                  setAssetContextMenu(null);
                }}>
                  Inspect asset
                </button>
              </div>
            );
          })() : null}
        </section>

        <aside className="panel right">
          <div className="panel-scroll">
            <div className="panel-tabs" role="tablist" aria-label="Tool panel">
              {(["inspector", "generate", "jobs"] as RightPanelTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={rightTab === tab ? "active" : ""}
                  aria-pressed={rightTab === tab}
                  onClick={() => setRightTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {rightTab === "inspector" ? (
              <section className="section">
                <div className="section-title">
                  <h2>Inspector</h2>
                  <span className="pill">{selectedClip ? "clip" : selectedAsset ? "asset" : "none"}</span>
                </div>
                {timelineSelection ? (
                  <div className="inspector-card">
                    <strong>Selected region</strong>
                    <p className="fine">
                      Track {snapshot.tracks.find((track) => track.id === timelineSelection.trackId)?.name ?? "Unknown"} / {timelineSelection.start.toFixed(2)}-{timelineSelection.end.toFixed(2)}s
                    </p>
                    {!timelineSelectionHasClip ? <p className="fine">[WARN] Select across a clip to use source models.</p> : null}
                    <div className="button-row">
                      <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={saveSelectionAsAsset}>
                        Save asset
                      </button>
                      <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={saveSelectionAsVoice}>
                        Save voice
                      </button>
                      <button className="button compact" type="button" disabled={!timelineSelectionHasClip || whisperBlockedForSelectedClip} onClick={transcribeSelection}>
                        Transcribe
                      </button>
                      <button className="button compact danger" type="button" disabled={!timelineSelectionHasClip} onClick={cutSelectedRegionToGap}>
                        Cut gap
                      </button>
                    </div>
                    <div className="button-row transform-row">
                      <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={() => useRegionModel("seed-inpaint")}>
                        Inpaint
                      </button>
                      <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={() => useRegionModel("seed-restyle")}>
                        Restyle
                      </button>
                      <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={() => useRegionModel("seed-voice-changer")}>
                        Voice-change
                      </button>
                      <button className="button compact" type="button" disabled={!timelineSelectionHasClip} onClick={() => useRegionModel("seed-extend")}>
                        Extend
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
                      <button className="button compact" type="button" onClick={saveSelectionAsAsset}>
                        Render clip
                      </button>
                      <button className="button compact" type="button" onClick={saveSelectionAsVoice}>
                        Save voice
                      </button>
                      <button className="button compact" type="button" disabled={!canTranscribeSelectedClip} onClick={transcribeSelection}>
                        Transcribe
                      </button>
                    </div>
                    <label className="field compact-field">
                      <span>Region start</span>
                      <input className="input" type="number" value={region.start} onChange={(event) => setRegion((r) => ({ ...r, start: Number(event.target.value) }))} />
                    </label>
                    <label className="field compact-field">
                      <span>Region end</span>
                      <input className="input" type="number" value={region.end} onChange={(event) => setRegion((r) => ({ ...r, end: Number(event.target.value) }))} />
                    </label>
                  </div>
                ) : selectedAsset ? (
                  <div className="inspector-card">
                    <strong>{selectedAsset.name}</strong>
                    <p className="fine">{selectedAsset.source} / {formatTime(selectedAsset.duration || 0)}</p>
                    <div className="button-row">
                      <button className="button compact" type="button" onClick={() => addAssetToTimeline(selectedAsset)}>
                        Add
                      </button>
                      <button className="button compact" type="button" onClick={() => saveAssetAsVoice(selectedAsset)}>
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
                      <div className="transcript-list">
                        {selectedClipTranscript.map((segment) => (
                          <div className="transcript-row" key={segment.id}>
                            <button
                              className="speaker"
                              type="button"
                              onClick={() => playTranscriptSpeaker(transcriptSpeakerKey(segment))}
                              aria-label={`Play only ${transcriptSpeakerKey(segment)} transcript blocks`}
                            >
                              {transcriptSpeakerKey(segment)}
                            </button>
                            <button className="transcript-block" type="button" onClick={() => selectTranscriptSegment(segment)}>
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
            ) : null}

            {rightTab === "generate" ? (
              <section className="section">
                <div className="section-title">
                  <h2>Generate</h2>
                  <button className="button ghost" type="button" onClick={useRecommendedModel}>
                    Route
                  </button>
                </div>
                <div className="model-picker-shell" onClick={(event) => event.stopPropagation()}>
                  <span className="label">Model</span>
                  <button
                    className="model-select-button"
                    type="button"
                    aria-expanded={modelPickerOpen}
                    onClick={() => setModelPickerOpen((open) => !open)}
                  >
                    <ProviderMark model={model} size={20} />
                    <span className="model-select-main">
                      <strong>{model.label}</strong>
                      <span>{model.provider} / {model.task}</span>
                    </span>
                    <span className="model-chevron">⌄</span>
                  </button>
                  {modelPickerOpen ? (
                    <div className="model-picker-popover">
                      <input
                        className="input model-search"
                        type="search"
                        placeholder="Search models"
                        value={modelQuery}
                        onChange={(event) => setModelQuery(event.target.value)}
                      />
                      <div className="model-filter-row">
                        <select className="select compact-select" value={modelProviderFilter} onChange={(event) => setModelProviderFilter(event.target.value)}>
                          <option value="">Provider</option>
                          {modelProviderFilters.map((provider) => (
                            <option key={provider} value={provider}>{provider}</option>
                          ))}
                        </select>
                        <select className="select compact-select" value={modelTaskFilter} onChange={(event) => setModelTaskFilter(event.target.value)}>
                          <option value="">Task</option>
                          {modelTaskFilters.map((task) => (
                            <option key={task} value={task}>{task}</option>
                          ))}
                        </select>
                        <select className="select compact-select" value={modelBestForFilter} onChange={(event) => setModelBestForFilter(event.target.value)}>
                          <option value="">Best for</option>
                          {modelBestForFilters.map((bestFor) => (
                            <option key={bestFor} value={bestFor}>{bestFor}</option>
                          ))}
                        </select>
                      </div>
                      {featuredModels.length ? (
                        <div className="model-picker-section">
                          <span className="label">Featured</span>
                          {featuredModels.map((item) => (
                            <button
                              className={`model-picker-row ${item.id === model.id ? "active" : ""}`}
                              key={`featured-${item.id}`}
                              type="button"
                              onClick={() => {
                                selectModel(item.id);
                                setModelPickerOpen(false);
                              }}
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
                      ) : null}
                      <div className="model-picker-section">
                        <span className="label">All models</span>
                        {groupedPickerModels.map((group) => (
                          <div className="model-provider-group" key={group.provider}>
                            <span className="model-provider-title">{group.provider} <span>{group.models.length} models</span></span>
                            {group.models.map((item) => (
                              <button
                                className={`model-picker-row ${item.id === model.id ? "active" : ""}`}
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  selectModel(item.id);
                                  setModelPickerOpen(false);
                                }}
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
                        {!filteredModelsForPicker.length ? <p className="fine">No models match these filters.</p> : null}
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
                  </div>
                  <p className="fine">{model.description}</p>
                  <ModelBadges model={model} />
                </div>
                <FieldEditor model={model} values={values} setValue={setField} />
                {model.needsVoice ? (
                  <label className="field">
                    <span>Voice</span>
                    <select className="select" value={selectedVoiceId} onChange={(event) => setSelectedVoiceId(event.target.value)}>
                      <option value="">Select voice</option>
                      {snapshot.voices.map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {(model.needsSource || model.needsVoice || activeSpeaker) ? (
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
                      <>
                        <div className="context-row">
                          <span className="label">Voice context</span>
                          <strong>{sourceContextClip ? "Attached from source audio" : "Waiting for source"}</strong>
                          <p className="fine">Seed Extend sends `source_audio_url` and continues the same voice/topic. The endpoint trims long refs internally to the latest ~28s context.</p>
                        </div>
                        {selectedVoice ? (
                          <div className="context-row muted-row">
                            <span className="label">Selected voice</span>
                            <strong>{selectedVoice.name}</strong>
                            <p className="fine">Not sent for Extend.</p>
                          </div>
                        ) : null}
                      </>
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
                        <span className="label">Active speaker</span>
                        <strong>{activeSpeaker}</strong>
                        <p className="fine">{activeSpeakerBlocks.length} visible transcript block(s). Speaker actions use the first visible block as the source region.</p>
                        <div className="button-row attached-actions">
                          <button className="button compact" type="button" disabled={!activeSpeakerBlocks.length} onClick={saveActiveSpeakerAsVoice}>
                            Save speaker as voice
                          </button>
                          <button className="button compact" type="button" disabled={!activeSpeakerBlocks.length} onClick={() => useActiveSpeakerModel("seed-extend")}>
                            Extend speaker
                          </button>
                          <button className="button compact" type="button" disabled={!activeSpeakerBlocks.length} onClick={() => useActiveSpeakerModel("seed-voice-changer")}>
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
                {lint.warnings.length ? (
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
                    onClick={runModel}
                  >
                    {promptIsEnhancing ? "Enhancing..." : runState.status === "submitting" ? "Running..." : "Run Model"}
                  </button>
                </div>
                <div className={`run-state ${runState.status}`}>
                  <span className="label">Run State</span>
                  <strong>{runState.label}</strong>
                  {runState.jobId ? <p className="fine">Job {runState.jobId}</p> : null}
                  {runState.error ? <p className="fine">[ERROR] {runState.error}</p> : null}
                </div>
              </section>
            ) : null}

            {rightTab === "jobs" ? (
              <section className="section">
                <div className="section-title">
                  <h2>Jobs</h2>
                  <span className="pill">{snapshot.jobs.length}</span>
                </div>
                <div className={`run-state ${runState.status}`}>
                  <span className="label">Run State</span>
                  <strong>{runState.label}</strong>
                  {runState.jobId ? <p className="fine">Job {runState.jobId}</p> : null}
                  {runState.error ? <p className="fine">[ERROR] {runState.error}</p> : null}
                </div>
                <div className="job-list">
                  {snapshot.jobs.map((job) => (
                    <div className="job" key={job.id}>
                      <strong>{job.modelId}</strong>
                      <p className="fine">{job.status.toUpperCase()} / {job.progress}% / {job.outputs.length} output(s)</p>
                      {job.error ? <p className="fine">[ERROR] {job.error}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </aside>
      </div>

      <footer className="transport">
        <div className="transport-readout">
          <div className="hero-time">{formatTime(playhead)}</div>
          <div className="label">Playhead / {formatTime(totalDuration)}</div>
        </div>
        <div className="transport-controls" aria-label="Timeline transport controls">
          <button className="transport-button" type="button" onClick={() => seekTimeline(Math.max(0, playhead - 5))}>
            -5
          </button>
          <button
            className="transport-button primary"
            type="button"
            disabled={snapshot.clips.length === 0}
            onClick={() => (transportStatus === "playing" ? pauseTimeline() : playTimeline())}
          >
            {transportStatus === "playing" ? "Pause" : "Play"}
          </button>
          <button className="transport-button" type="button" onClick={() => stopTimeline(true)}>
            Stop
          </button>
          <button className="transport-button" type="button" onClick={() => seekTimeline(Math.min(totalDuration, playhead + 5))}>
            +5
          </button>
        </div>
        <input
          className="scrub"
          type="range"
          min={0}
          max={Math.max(totalDuration, 1)}
          step={0.01}
          value={Math.min(playhead, Math.max(totalDuration, 1))}
          onChange={(event) => seekTimeline(Number(event.target.value))}
          aria-label="Timeline scrubber"
        />
        <div className="meter" aria-hidden="true">
          {Array.from({ length: 16 }).map((_, index) => (
            <span key={index} className={index < Math.min(16, snapshot.clips.length * 3) ? "on" : ""} />
          ))}
        </div>
        <button className="button" type="button" disabled={snapshot.clips.length === 0} onClick={exportWav}>
          Export WAV
        </button>
        <button className="button ghost" type="button" onClick={() => setSnapshot(defaultSnapshot())}>
          Reset local
        </button>
        <span className="status">{transportStatus.toUpperCase()} / 48KHZ / WAV</span>
      </footer>
    </main>
  );
}
