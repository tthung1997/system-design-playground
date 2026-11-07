import { emptyLearningData, parseLearningData, serializeLearningData } from '../learning/data.ts';
import type { LearningData } from '../learning/data.ts';
import { storage } from './storage.ts';

const KEY = 'system-design-playground:learning';
const CORRUPT_KEY = `${KEY}:corrupt-backup`;

export interface LoadedLearning {
  data: LearningData;
  warnings: string[];
}

/** Loads saved progress. Unreadable data is preserved under a backup key rather than silently dropped. */
export function loadLearning(): LoadedLearning {
  const store = storage();
  let raw: string | null = null;
  try {
    raw = store?.getItem(KEY) ?? null;
  } catch {
    return { data: emptyLearningData(), warnings: ['Browser storage is blocked, so progress will not be saved.'] };
  }
  if (!raw) return { data: emptyLearningData(), warnings: [] };
  const parsed = parseLearningData(raw);
  if (parsed.ok) return parsed.value;
  try {
    store?.setItem(CORRUPT_KEY, raw);
  } catch {
    // Nothing more we can do; the original entry stays in place until the next save.
  }
  return {
    data: emptyLearningData(),
    warnings: [`Saved progress could not be read (${parsed.error}). A copy was kept under "${CORRUPT_KEY}" in browser storage.`],
  };
}

/** Returns an error message when progress could not be saved. */
export function saveLearning(data: LearningData): string | null {
  const store = storage();
  if (!store) return 'Browser storage is unavailable, so progress will not be saved.';
  try {
    store.setItem(KEY, serializeLearningData(data));
    return null;
  } catch {
    return 'Could not save progress (browser storage is full or blocked). Use Export backup to keep a copy.';
  }
}
