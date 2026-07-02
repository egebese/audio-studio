export type TrackKind = "voice" | "music" | "sfx";
export type AssetKind = "audio";
export type AssetSource = "generated" | "upload" | "derived";
export type JobStatus = "queued" | "running" | "done" | "error";
export type ModelKind = "generate" | "transform" | "reference" | "utility";

export interface Project {
  id: string;
  name: string;
  sampleRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface Track {
  id: string;
  projectId: string;
  kind: TrackKind;
  name: string;
  gain: number;
  muted: boolean;
  solo: boolean;
  order: number;
}

export interface DerivedFrom {
  assetId: string;
  modelId: string;
  operation: string;
  params: Record<string, unknown>;
  jobId?: string;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface DiarizationSegment {
  id: string;
  start: number;
  end: number;
  speaker: string;
}

export interface Asset {
  id: string;
  projectId: string;
  kind: AssetKind;
  trackKind?: TrackKind;
  name: string;
  url: string;
  duration: number;
  source: AssetSource;
  createdAt: string;
  derivedFrom?: DerivedFrom;
  transcript?: string;
  transcriptSegments?: TranscriptSegment[];
  diarizationSegments?: DiarizationSegment[];
}

export interface Clip {
  id: string;
  trackId: string;
  assetId: string;
  start: number;
  duration: number;
  offset: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
}

export interface Voice {
  id: string;
  projectId: string;
  name: string;
  refAssetId: string;
  provider?: string;
  createdAt: string;
}

export interface PromptDraft {
  id: string;
  modelId: string;
  raw: string;
  enhanced: string;
  warnings: string[];
  createdAt: string;
}

export interface ModelRun {
  id: string;
  jobId: string;
  modelId: string;
  operation: string;
  input: Record<string, unknown>;
  outputAssetIds: string[];
  createdAt: string;
}

export interface Job {
  id: string;
  modelId: string;
  operation: string;
  input: Record<string, unknown>;
  sourceAssetIds: string[];
  status: JobStatus;
  progress: number;
  logs: string[];
  outputs: ModelOutput[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelOutput {
  url?: string;
  duration: number;
  contentType?: string;
  transcript?: string;
  transcriptSegments?: TranscriptSegment[];
  diarizationSegments?: DiarizationSegment[];
  prompt?: string;
  raw?: unknown;
}

export interface ProjectSnapshot {
  project: Project;
  tracks: Track[];
  clips: Clip[];
  assets: Asset[];
  voices: Voice[];
  jobs: Job[];
  promptDrafts: PromptDraft[];
  modelRuns: ModelRun[];
}

export interface Region {
  start: number;
  end: number;
}
