// UI-local state types shared between studio.tsx and its extracted panels/components.
// Domain types live in ./types; these describe transient studio UI state only.

export type RunStatus = "idle" | "validating" | "submitting" | "done" | "error";
export type TransportStatus = "stopped" | "playing" | "paused";
export type PromptEnhanceStatus = "idle" | "enhancing" | "done" | "error";
export type ProjectFilter = "all" | "upload" | "generated" | "derived" | "voices";

export interface RunUiState {
  status: RunStatus;
  label: string;
  jobId?: string;
  error?: string;
  progress?: number;
  logLine?: string;
}

export interface PromptEnhanceState {
  modelId: string;
  raw: string;
  voiceKey: string;
  enhanced: string;
  status: PromptEnhanceStatus;
  source?: "llm";
  error?: string;
}

export interface TimelineSelection {
  trackId: string;
  start: number;
  end: number;
}

export interface Toast {
  text: string;
  kind: "ok" | "err";
}

export interface RenameTarget {
  kind: "asset" | "voice";
  id: string;
}
