import { create } from 'zustand';
import type { Evaluation } from '../challenges/types.ts';
import { mergeLearningData, parseLearningData } from '../learning/data.ts';
import type { LearningData, Submission, WorkspaceSnapshot } from '../learning/data.ts';
import type { Graph } from '../model/types.ts';
import { loadLearning, saveLearning } from './learningStorage.ts';

export interface LearningState {
  data: LearningData;
  /** Problems found while loading saved data; shown once to the user. */
  warnings: string[];
  saveError: string | null;

  recordAnswer: (lessonId: string, stepId: string, value: number) => void;
  completeLesson: (lessonId: string) => void;
  resetLesson: (lessonId: string) => void;
  saveDraft: (key: string, snap: WorkspaceSnapshot) => string | null;
  removeDraft: (key: string) => void;
  addSubmission: (graph: Graph, evaluation: Evaluation) => Submission;
  importBackup: (text: string) => { ok: true; message: string } | { ok: false; error: string };
  dismissWarnings: () => void;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

let counter = 0;
const newId = () => `sub-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const useLearning = create<LearningState>()((set, get) => {
  const loaded = loadLearning();

  /** Applies a change and persists it, reporting storage problems instead of hiding them. */
  const commit = (fn: (d: LearningData) => LearningData): string | null => {
    const data = fn(get().data);
    const saveError = saveLearning(data);
    set({ data, saveError });
    return saveError;
  };

  return {
    data: loaded.data,
    warnings: loaded.warnings,
    saveError: null,

    recordAnswer: (lessonId, stepId, value) =>
      commit((d) => {
        const p = d.lessons[lessonId] ?? { answers: {} };
        return { ...d, lessons: { ...d.lessons, [lessonId]: { ...p, answers: { ...p.answers, [stepId]: value } } } };
      }),

    completeLesson: (lessonId) => {
      if (get().data.lessons[lessonId]?.completedAt) return;
      commit((d) => {
        const p = d.lessons[lessonId] ?? { answers: {} };
        return { ...d, lessons: { ...d.lessons, [lessonId]: { ...p, completedAt: new Date().toISOString() } } };
      });
    },

    // Resets the working diagram and answers; the completion record stays so progress is never lost by revisiting.
    resetLesson: (lessonId) =>
      commit((d) => {
        const { [`lesson:${lessonId}`]: _removed, ...drafts } = d.drafts;
        void _removed;
        const p = d.lessons[lessonId];
        const lessons = p ? { ...d.lessons, [lessonId]: { ...p, answers: {} } } : d.lessons;
        return { ...d, drafts, lessons };
      }),

    saveDraft: (key, snap) => commit((d) => ({ ...d, drafts: { ...d.drafts, [key]: snap } })),

    removeDraft: (key) =>
      commit((d) => {
        const { [key]: _removed, ...drafts } = d.drafts;
        void _removed;
        return { ...d, drafts };
      }),

    addSubmission: (graph, evaluation) => {
      const sub: Submission = deepFreeze({
        id: newId(),
        challengeId: evaluation.challengeId,
        challengeVersion: evaluation.challengeVersion,
        simVersion: evaluation.simVersion,
        judgeVersion: evaluation.judgeVersion,
        createdAt: new Date().toISOString(),
        graph: structuredClone(graph),
        evaluation: structuredClone(evaluation),
      });
      commit((d) => ({ ...d, submissions: [...d.submissions, sub] }));
      return sub;
    },

    importBackup: (text) => {
      const parsed = parseLearningData(text);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const before = get().data.submissions.length;
      const error = commit((d) => mergeLearningData(d, parsed.value.data));
      const added = get().data.submissions.length - before;
      const skipped = parsed.value.warnings.length;
      return {
        ok: true,
        message: `Imported backup: ${added} new submission(s)${skipped ? `, ${skipped} invalid entr${skipped === 1 ? 'y' : 'ies'} skipped` : ''}${error ? `. ${error}` : ''}`,
      };
    },

    dismissWarnings: () => set({ warnings: [] }),
  };
});
