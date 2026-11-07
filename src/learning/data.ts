import type { Evaluation } from '../challenges/types.ts';
import { parseDocument } from '../model/document.ts';
import type { Graph, Workload } from '../model/types.ts';

export const LEARNING_VERSION = 1;

export interface WorkspaceSnapshot {
  graph: Graph;
  workload: Workload;
}

/** An immutable record of one judged attempt. */
export interface Submission {
  id: string;
  challengeId: string;
  challengeVersion: number;
  simVersion: number;
  judgeVersion: number;
  createdAt: string;
  graph: Graph;
  evaluation: Evaluation;
}

export interface LessonProgress {
  completedAt?: string;
  /** Numeric answers keyed by step id. */
  answers: Record<string, number>;
}

export interface LearningData {
  version: number;
  lessons: Record<string, LessonProgress>;
  drafts: Record<string, WorkspaceSnapshot>;
  submissions: Submission[];
}

export const emptyLearningData = (): LearningData => ({ version: LEARNING_VERSION, lessons: {}, drafts: {}, submissions: [] });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);

function parseSnapshot(raw: unknown, path: string): WorkspaceSnapshot {
  if (!isObject(raw)) throw new Error(`${path} must be an object`);
  const parsed = parseDocument({ version: 3, graph: raw.graph, workload: raw.workload ?? { rps: 1000, readRatio: 0.9, durationSec: 60 } });
  if (!parsed.ok) throw new Error(`${path}: ${parsed.error}`);
  return { graph: parsed.doc.graph, workload: parsed.doc.workload! };
}

function parseEvaluation(raw: unknown, path: string): Evaluation {
  if (!isObject(raw)) throw new Error(`${path} must be an object`);
  const s = raw.summary;
  if (
    typeof raw.challengeId !== 'string' ||
    !isNum(raw.challengeVersion) ||
    !isNum(raw.simVersion) ||
    !isNum(raw.judgeVersion) ||
    typeof raw.valid !== 'boolean' ||
    !(raw.stars === 0 || raw.stars === 1 || raw.stars === 2 || raw.stars === 3) ||
    !isNum(raw.score) ||
    !Array.isArray(raw.errors) ||
    !Array.isArray(raw.scenarios) ||
    !Array.isArray(raw.criteria) ||
    !Array.isArray(raw.feedback) ||
    !isObject(s) ||
    !isNum(s.costUsd) ||
    !isNumOrNull(s.latencyMs) ||
    !isNumOrNull(s.availabilityPct) ||
    !isNumOrNull(s.failureServedPct)
  ) {
    throw new Error(`${path} is not a valid evaluation`);
  }
  return raw as unknown as Evaluation;
}

function parseSubmission(raw: unknown, i: number): Submission {
  const path = `submissions[${i}]`;
  if (!isObject(raw)) throw new Error(`${path} must be an object`);
  if (typeof raw.id !== 'string' || !raw.id) throw new Error(`${path}.id is missing`);
  if (typeof raw.challengeId !== 'string') throw new Error(`${path}.challengeId is missing`);
  if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) throw new Error(`${path}.createdAt is invalid`);
  if (!isNum(raw.challengeVersion) || !isNum(raw.simVersion) || !isNum(raw.judgeVersion)) throw new Error(`${path} is missing version numbers`);
  const snap = parseSnapshot({ graph: raw.graph }, `${path}.graph`);
  return {
    id: raw.id,
    challengeId: raw.challengeId,
    challengeVersion: raw.challengeVersion,
    simVersion: raw.simVersion,
    judgeVersion: raw.judgeVersion,
    createdAt: raw.createdAt,
    graph: snap.graph,
    evaluation: parseEvaluation(raw.evaluation, `${path}.evaluation`),
  };
}

export interface ParsedLearning {
  data: LearningData;
  /** Entries that were skipped because they were invalid; everything else still loads. */
  warnings: string[];
}

/** Parses each section independently so one corrupt entry never discards unrelated saved work. */
export function parseLearningData(input: unknown): { ok: true; value: ParsedLearning } | { ok: false; error: string } {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'The data is not valid JSON' };
    }
  }
  if (!isObject(raw)) return { ok: false, error: 'The data must be an object' };
  if (raw.version !== LEARNING_VERSION) return { ok: false, error: `Unsupported learning data version ${String(raw.version)}` };
  const data = emptyLearningData();
  const warnings: string[] = [];

  if (isObject(raw.lessons)) {
    for (const [id, p] of Object.entries(raw.lessons)) {
      if (!isObject(p)) {
        warnings.push(`Skipped progress for lesson "${id}"`);
        continue;
      }
      const answers: Record<string, number> = {};
      if (isObject(p.answers)) for (const [k, v] of Object.entries(p.answers)) if (isNum(v)) answers[k] = v;
      const entry: LessonProgress = { answers };
      if (typeof p.completedAt === 'string') entry.completedAt = p.completedAt;
      data.lessons[id] = entry;
    }
  }
  if (isObject(raw.drafts)) {
    for (const [key, d] of Object.entries(raw.drafts)) {
      try {
        data.drafts[key] = parseSnapshot(d, `drafts.${key}`);
      } catch (e) {
        warnings.push(`Skipped draft "${key}": ${(e as Error).message}`);
      }
    }
  }
  if (Array.isArray(raw.submissions)) {
    const seen = new Set<string>();
    raw.submissions.forEach((s, i) => {
      try {
        const sub = parseSubmission(s, i);
        if (seen.has(sub.id)) throw new Error(`duplicate id ${sub.id}`);
        seen.add(sub.id);
        data.submissions.push(sub);
      } catch (e) {
        warnings.push(`Skipped submission ${i + 1}: ${(e as Error).message}`);
      }
    });
  }
  return { ok: true, value: { data, warnings } };
}

export function serializeLearningData(data: LearningData): string {
  const drafts: Record<string, unknown> = {};
  for (const [key, snap] of Object.entries(data.drafts)) {
    drafts[key] = { graph: snap.graph, workload: snap.workload };
  }
  return JSON.stringify({ ...data, version: LEARNING_VERSION, drafts }, null, 2);
}

/** Combines an imported backup into the current data: progress and submissions are united; imported drafts replace current ones. */
export function mergeLearningData(current: LearningData, incoming: LearningData): LearningData {
  const lessons = { ...current.lessons };
  for (const [id, p] of Object.entries(incoming.lessons)) {
    const mine = lessons[id];
    lessons[id] = {
      completedAt: mine?.completedAt ?? p.completedAt,
      answers: { ...p.answers, ...mine?.answers },
    };
  }
  const known = new Set(current.submissions.map((s) => s.id));
  const submissions = [...current.submissions, ...incoming.submissions.filter((s) => !known.has(s.id))];
  return { version: LEARNING_VERSION, lessons, drafts: { ...current.drafts, ...incoming.drafts }, submissions };
}
