import { parseDocument, serializeDocument } from '../model/document.ts';
import type { PlaygroundDocument } from '../model/document.ts';

const KEY = 'system-design-playground:document';

function storage(): Storage | null {
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

export function saveDocument(doc: Pick<PlaygroundDocument, 'graph' | 'scenario'>): void {
  try {
    storage()?.setItem(KEY, serializeDocument(doc));
  } catch {
    // Storage full or unavailable; autosave is best effort.
  }
}
