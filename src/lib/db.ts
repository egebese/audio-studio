"use client";

import type { ProjectSnapshot } from "./types";

const DB_NAME = "audio-studio-v1";
const STORE = "snapshots";
// Snapshots are stored per project id; "__index" tracks the project list + active id.
const INDEX_KEY = "__index";
const LEGACY_KEY = "default";

export interface ProjectRef {
  id: string;
  name: string;
}

interface StoreIndex {
  activeId: string;
  projects: ProjectRef[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface Workspace {
  snapshot?: ProjectSnapshot;
  projects: ProjectRef[];
  activeId?: string;
}

// Loads the project index + active snapshot, migrating a pre-multi-project
// single "default" snapshot into the index on first run.
export async function loadWorkspace(): Promise<Workspace> {
  const index = await get<StoreIndex>(INDEX_KEY);
  if (index) {
    const snapshot = await get<ProjectSnapshot>(index.activeId);
    return { snapshot, projects: index.projects, activeId: index.activeId };
  }
  const legacy = await get<ProjectSnapshot>(LEGACY_KEY);
  if (legacy) {
    await put(legacy.project.id, legacy);
    const projects = [{ id: legacy.project.id, name: legacy.project.name }];
    await put(INDEX_KEY, { activeId: legacy.project.id, projects });
    return { snapshot: legacy, projects, activeId: legacy.project.id };
  }
  return { projects: [] };
}

export async function loadSnapshotById(id: string): Promise<ProjectSnapshot | undefined> {
  return get<ProjectSnapshot>(id);
}

// Removes every project whose id starts with `prefix` (used to replace the demo
// set on import so stale previews don't accumulate in the switcher).
export async function deleteSnapshotsByPrefix(prefix: string): Promise<ProjectRef[]> {
  const index = await get<StoreIndex>(INDEX_KEY);
  if (!index) return [];
  const doomed = index.projects.filter((p) => p.id.startsWith(prefix)).map((p) => p.id);
  if (!doomed.length) return index.projects;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of doomed) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const projects = index.projects.filter((p) => !doomed.includes(p.id));
  const activeId = doomed.includes(index.activeId) ? projects[0]?.id ?? "" : index.activeId;
  await put(INDEX_KEY, { activeId, projects });
  return projects;
}

// Bulk-saves showcase/demo snapshots into the index WITHOUT changing the active
// project — used to auto-populate the switcher on first launch. Existing ids are
// overwritten (idempotent), new ids appended; the current activeId is preserved.
export async function seedSnapshots(snapshots: ProjectSnapshot[]): Promise<ProjectRef[]> {
  if (!snapshots.length) return (await get<StoreIndex>(INDEX_KEY))?.projects ?? [];
  const db = await openDb();
  const index = (await get<StoreIndex>(INDEX_KEY)) ?? { activeId: "", projects: [] };
  const projects = [...index.projects];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const snap of snapshots) {
      store.put(snap, snap.project.id);
      const ref = { id: snap.project.id, name: snap.project.name };
      const at = projects.findIndex((p) => p.id === ref.id);
      if (at >= 0) projects[at] = ref;
      else projects.push(ref);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await put(INDEX_KEY, { activeId: index.activeId, projects });
  return projects;
}

// Removes specific projects by id (used to retire showcase pieces that were
// dropped from the app). Reassigns the active project if it was one of them.
export async function deleteSnapshotsByIds(ids: string[]): Promise<ProjectRef[]> {
  const index = await get<StoreIndex>(INDEX_KEY);
  if (!index) return [];
  const doomed = index.projects.filter((p) => ids.includes(p.id)).map((p) => p.id);
  if (!doomed.length) return index.projects;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of doomed) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const projects = index.projects.filter((p) => !doomed.includes(p.id));
  const activeId = doomed.includes(index.activeId) ? projects[0]?.id ?? "" : index.activeId;
  await put(INDEX_KEY, { activeId, projects });
  return projects;
}

// Saves the snapshot under its project id, keeps the index name in sync,
// and marks the project active.
export async function saveSnapshot(snapshot: ProjectSnapshot): Promise<ProjectRef[]> {
  await put(snapshot.project.id, snapshot);
  const index = (await get<StoreIndex>(INDEX_KEY)) ?? { activeId: snapshot.project.id, projects: [] };
  const ref = { id: snapshot.project.id, name: snapshot.project.name };
  const existing = index.projects.findIndex((project) => project.id === ref.id);
  const projects = existing >= 0 ? index.projects.map((p, i) => (i === existing ? ref : p)) : [...index.projects, ref];
  await put(INDEX_KEY, { activeId: snapshot.project.id, projects });
  return projects;
}
