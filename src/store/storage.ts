import { parseDocument, serializeDocument } from '../model/document.ts';
import type { PlaygroundDocument } from '../model/document.ts';

const KEY = 'system-design-playground:document';

export function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSavedDocument(): PlaygroundDocument | null {
  const raw = storage()?.getItem(KEY);
  if (!raw) return null;
  const parsed = parseDocument(raw);
  return parsed.ok ? parsed.doc : null;
}

/** Returns an error message when the document could not be saved. */
export function saveDocument(doc: Pick<PlaygroundDocument, 'graph' | 'workload'>): string | null {
  const store = storage();
  if (!store) return 'Browser storage is unavailable, so changes will not be saved.';
  try {
    store.setItem(KEY, serializeDocument(doc));
    return null;
  } catch {
    return 'Could not save your diagram (browser storage is full or blocked). Export it to keep a copy.';
  }
}
