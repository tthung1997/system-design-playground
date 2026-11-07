import type { WorkspaceSnapshot } from '../learning/data.ts';
import { DEFAULT_WORKLOAD } from '../model/defaults.ts';
import { loadSavedDocument, saveDocument } from './storage.ts';
import { useLearning } from './learningStore.ts';

/** 'playground', 'lesson:<id>' or 'challenge:<id>'. Each workspace keeps its own diagram and history. */
export type WorkspaceKey = string;

export const PLAYGROUND: WorkspaceKey = 'playground';

export function loadWorkspace(key: WorkspaceKey): WorkspaceSnapshot | null {
  if (key === PLAYGROUND) {
    const doc = loadSavedDocument();
    return doc ? { graph: doc.graph, workload: doc.workload ?? DEFAULT_WORKLOAD } : null;
  }
  return useLearning.getState().data.drafts[key] ?? null;
}

/** Saves a workspace immediately. Returns an error message if it could not be stored. */
export function saveWorkspace(key: WorkspaceKey, snap: WorkspaceSnapshot): string | null {
  if (key === PLAYGROUND) return saveDocument(snap);
  return useLearning.getState().saveDraft(key, snap);
}

interface Pending {
  key: WorkspaceKey;
  snap: WorkspaceSnapshot;
}

/** The last snapshot known to match storage (or that was just loaded) for each workspace. */
const baseline = new Map<WorkspaceKey, WorkspaceSnapshot>();

export function markBaseline(key: WorkspaceKey, snap: WorkspaceSnapshot) {
  baseline.set(key, snap);
}

/** Saves a workspace right away if it differs from what was loaded or last saved. */
export function saveIfChanged(key: WorkspaceKey, snap: WorkspaceSnapshot): string | null {
  const known = baseline.get(key);
  if (known && known.graph === snap.graph && known.workload === snap.workload) return null;
  const error = saveWorkspace(key, snap);
  if (!error) baseline.set(key, snap);
  return error;
}

let pending: Pending | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let reportError: (message: string) => void = () => {};

export function onSaveError(fn: (message: string) => void) {
  reportError = fn;
}

export function scheduleSave(key: WorkspaceKey, snap: WorkspaceSnapshot, delayMs = 400) {
  pending = { key, snap };
  clearTimeout(timer);
  timer = setTimeout(flushPending, delayMs);
}

/** Writes any debounced change right away; called before switching workspaces so nothing is lost. */
export function flushPending() {
  clearTimeout(timer);
  if (!pending) return;
  const { key, snap } = pending;
  pending = null;
  const error = saveWorkspace(key, snap);
  if (error) reportError(error);
  else baseline.set(key, snap);
}
