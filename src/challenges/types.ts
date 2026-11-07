import type { Graph, NodeKind, Workload } from '../model/types.ts';

/** Bumped when evaluation or scoring rules change (not when a single challenge is retuned; use its own version). */
export const JUDGE_VERSION = 1;

export type MetricKey =
  | 'costUsd'
  | 'servedPct'
  | 'availabilityPct'
  | 'tailLatencyMs'
  | 'meanLatencyMs'
  | 'lostMessages'
  | 'drainSeconds';

export type Category = 'cost' | 'reliability' | 'latency' | 'delivery';

export interface Scenario {
  id: string;
  label: string;
  workload: Workload;
  /** When true the run reports the worst outcome of any single replica failing. */
  failure?: boolean;
}

export interface Criterion {
  id: string;
  label: string;
  category: Category;
  metric: MetricKey;
  /** Not needed for cost, which does not depend on traffic. */
  scenarioId?: string;
  better: 'higher' | 'lower';
  /** Thresholds that earn 1, 2 and 3 stars. A tier is passed when the value meets or beats its threshold. */
  tiers: [number, number, number];
  /** Fixed reference points used to turn a value into a 0..1 score; independent of other submissions. */
  best: number;
  worst: number;
  weight: number;
  unit: string;
  hint: string;
}

export interface ChallengeDef {
  id: string;
  /** Bump when the prompt, scenarios, thresholds or weights change; rankings never mix versions. */
  version: number;
  title: string;
  difficulty: 'Starter' | 'Intermediate' | 'Advanced';
  summary: string;
  story: string[];
  requirements: string[];
  scenarios: Scenario[];
  criteria: Criterion[];
  /** Scenario whose latency and availability feed the summary and the metric rankings. */
  primaryScenarioId: string;
  failureScenarioId?: string;
  /** Component kinds that must appear on every path from the clients to a database. */
  requiredOnEveryPath: NodeKind[];
  maxComponents: number;
  starter: Graph;
}

export interface ScenarioResult {
  id: string;
  label: string;
  ok: boolean;
  servedPct: number | null;
  availabilityPct: number | null;
  tailLatencyMs: number | null;
  meanLatencyMs: number | null;
  lostMessages: number;
  drainSeconds: number | null;
  bottleneck: string | null;
  failedComponent: string | null;
}

export interface CriterionResult {
  id: string;
  label: string;
  category: Category;
  metric: MetricKey;
  scenarioId: string | null;
  unit: string;
  better: 'higher' | 'lower';
  value: number | null;
  targets: [number, number, number];
  passed: [boolean, boolean, boolean];
  /** 0..1 position between the criterion's worst and best reference points. */
  normalized: number;
  weight: number;
}

export interface Summary {
  costUsd: number;
  latencyMs: number | null;
  availabilityPct: number | null;
  failureServedPct: number | null;
}

export interface Evaluation {
  challengeId: string;
  challengeVersion: number;
  simVersion: number;
  judgeVersion: number;
  /** False when the design cannot be simulated or breaks the challenge's structural rules. */
  valid: boolean;
  errors: string[];
  stars: 0 | 1 | 2 | 3;
  score: number;
  scenarios: ScenarioResult[];
  criteria: CriterionResult[];
  summary: Summary;
  feedback: string[];
}
