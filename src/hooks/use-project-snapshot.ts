"use client";

import * as React from "react";
import {
  deleteSnapshotsByIds,
  deleteSnapshotsByPrefix,
  loadSnapshotById,
  loadWorkspace,
  saveSnapshot,
  seedSnapshots,
  type ProjectRef
} from "@/lib/db";
import { defaultSnapshot, uid } from "@/lib/studio-helpers";
import { normalizeTrackOrder } from "@/lib/track-ops";
import type { ProjectSnapshot, Track } from "@/lib/types";

// Owns the local-first project graph: initial IndexedDB load, debounced autosave,
// the patch helpers every mutation funnels through, and multi-project switching.
export function useProjectSnapshot() {
  const [snapshot, setSnapshot] = React.useState<ProjectSnapshot | null>(null);
  const [projects, setProjects] = React.useState<ProjectRef[]>([]);
  const [saving, setSaving] = React.useState(false);
  const snapshotRef = React.useRef<ProjectSnapshot | null>(null);
  snapshotRef.current = snapshot;

  React.useEffect(() => {
    let alive = true;
    loadWorkspace()
      .then((workspace) => {
        if (!alive) return;
        setSnapshot(workspace.snapshot ?? defaultSnapshot());
        setProjects(workspace.projects);
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
      saveSnapshot(snapshot)
        .then(setProjects)
        .catch(() => undefined)
        .finally(() => setSaving(false));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [snapshot]);

  const patchSnapshot = React.useCallback((updater: (current: ProjectSnapshot) => ProjectSnapshot) => {
    setSnapshot((current) => (current ? updater(current) : current));
  }, []);

  const patchTracks = React.useCallback(
    (updater: (tracks: Track[]) => Track[]) => {
      patchSnapshot((current) => ({ ...current, tracks: normalizeTrackOrder(updater(current.tracks)) }));
    },
    [patchSnapshot]
  );

  // Flushes the current project (the debounced autosave may still be pending), then loads the target.
  const switchProject = React.useCallback(async (id: string) => {
    const current = snapshotRef.current;
    if (!current || current.project.id === id) return;
    await saveSnapshot(current);
    const next = await loadSnapshotById(id);
    if (next) {
      setSnapshot(next);
      setProjects(await saveSnapshot(next)); // marks it active + refreshes the index
    }
  }, []);

  const createProject = React.useCallback(async (name?: string) => {
    const current = snapshotRef.current;
    if (current) await saveSnapshot(current);
    const next = defaultSnapshot(uid("project"), name ?? `Project ${projects.length + 1}`);
    setSnapshot(next);
    setProjects(await saveSnapshot(next));
    return next;
  }, [projects.length]);

  // Saves a fully-formed snapshot (e.g. a generated cinematic piece) as a new project and
  // switches to it, preserving the current project.
  const addProject = React.useCallback(async (snap: ProjectSnapshot) => {
    const current = snapshotRef.current;
    if (current) await saveSnapshot(current);
    setSnapshot(snap);
    setProjects(await saveSnapshot(snap));
  }, []);

  // Replaces the demo set: prunes any stale `preview_*` projects, then bulk-saves
  // the given snapshots and switches to the first one. A non-demo current project
  // is preserved; a demo one is being replaced so it isn't re-saved.
  const importSnapshots = React.useCallback(async (snapshots: ProjectSnapshot[]) => {
    if (!snapshots.length) return;
    const current = snapshotRef.current;
    if (current && !current.project.id.startsWith("preview_")) await saveSnapshot(current);
    await deleteSnapshotsByPrefix("preview_");
    for (const snap of snapshots) await saveSnapshot(snap);
    setSnapshot(snapshots[0]);
    setProjects(await saveSnapshot(snapshots[0]));
  }, []);

  // Adds showcase/demo projects to the switcher without leaving the current project.
  // Flushes the current project first so it keeps the active slot, prunes any retired
  // ids from a prior build, then seeds the current curated set.
  const seedProjects = React.useCallback(async (snapshots: ProjectSnapshot[], pruneIds: string[] = []) => {
    if (!snapshots.length) return;
    const current = snapshotRef.current;
    if (current) await saveSnapshot(current);
    if (pruneIds.length) await deleteSnapshotsByIds(pruneIds);
    setProjects(await seedSnapshots(snapshots));
  }, []);

  return {
    snapshot,
    setSnapshot,
    saving,
    patchSnapshot,
    patchTracks,
    projects,
    switchProject,
    createProject,
    addProject,
    importSnapshots,
    seedProjects
  };
}
