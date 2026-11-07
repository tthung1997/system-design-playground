import type { Graph } from '../model/types.ts';
import { SIM_VERSION } from '../simulation/catalog.ts';
import { simulate, totalMonthlyCost } from '../simulation/simulate.ts';
import type { SimResult } from '../simulation/simulate.ts';
import { JUDGE_VERSION } from './types.ts';
import type { ChallengeDef, Criterion, CriterionResult, Evaluation, ScenarioResult } from './types.ts';

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const pct = (ratio: number | null) => (ratio === null ? null : round(ratio * 100, 4));

/** True when a client can still reach a database after removing every component of the given kinds. */
function bypassesKinds(graph: Graph, kinds: string[]): boolean {
  const removed = new Set(graph.nodes.filter((n) => kinds.includes(n.kind)).map((n) => n.id));
  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const seen = new Set<string>();
  const stack = graph.nodes.filter((n) => n.kind === 'client').map((n) => n.id);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id) || removed.has(id)) continue;
    seen.add(id);
    if (kind.get(id) === 'database') return true;
    stack.push(...(adj.get(id) ?? []));
  }
  return false;
}

function metricValue(c: Criterion, costUsd: number, results: Map<string, { sim: SimResult; effective: SimResult['failure'] | SimResult }>): number | null {
  if (c.metric === 'costUsd') return costUsd;
  const entry = results.get(c.scenarioId ?? '');
  if (!entry) return null;
  const m = entry.effective;
  if (!m) return null;
  switch (c.metric) {
    case 'servedPct':
      return pct(m.servedRatio);
    case 'availabilityPct':
      return pct(entry.sim.availability);
    case 'tailLatencyMs':
      return m.tailLatencyMs === null ? null : round(m.tailLatencyMs, 1);
    case 'meanLatencyMs':
      return m.meanLatencyMs === null ? null : round(m.meanLatencyMs, 1);
    case 'lostMessages':
      return m.servedRatio === null ? null : Math.round(m.queue?.lostMessages ?? 0);
    case 'drainSeconds':
      return m.servedRatio === null ? null : m.queue ? (m.queue.drainSeconds === null ? null : round(m.queue.drainSeconds, 1)) : 0;
    default:
      return null;
  }
}

const meets = (c: Criterion, value: number | null, target: number) =>
  value !== null && (c.better === 'higher' ? value >= target : value <= target);

function normalize(c: Criterion, value: number | null): number {
  if (value === null) return 0;
  const span = c.best - c.worst;
  if (span === 0) return meets(c, value, c.best) ? 1 : 0;
  return Math.min(1, Math.max(0, (value - c.worst) / span));
}

/**
 * Judges one design against every scenario of a challenge. Structural problems or any unmet
 * 1-star requirement give zero stars regardless of the weighted score.
 */
export function evaluateChallenge(def: ChallengeDef, graph: Graph): Evaluation {
  const errors: string[] = [];
  const costUsd = totalMonthlyCost(graph);
  const results = new Map<string, { sim: SimResult; effective: SimResult['failure'] | SimResult }>();
  const scenarios: ScenarioResult[] = [];

  if (graph.nodes.length > def.maxComponents) {
    errors.push(`This challenge allows at most ${def.maxComponents} components (you have ${graph.nodes.length}).`);
  }

  for (const s of def.scenarios) {
    const sim = simulate(graph, s.workload, { failure: s.failure ? 'worst-single-replica' : 'none' });
    for (const i of sim.issues) {
      if (i.severity === 'error' && !errors.includes(i.message)) errors.push(i.message);
    }
    const effective = s.failure ? sim.failure : sim;
    results.set(s.id, { sim, effective });
    const e = effective;
    scenarios.push({
      id: s.id,
      label: s.label,
      ok: sim.ok,
      servedPct: e ? pct(e.servedRatio) : null,
      availabilityPct: pct(sim.availability),
      tailLatencyMs: e?.tailLatencyMs == null ? null : round(e.tailLatencyMs, 1),
      meanLatencyMs: e?.meanLatencyMs == null ? null : round(e.meanLatencyMs, 1),
      lostMessages: Math.round(e?.queue?.lostMessages ?? 0),
      drainSeconds: e?.queue ? (e.queue.drainSeconds === null ? null : round(e.queue.drainSeconds, 1)) : 0,
      bottleneck: sim.bottleneckId ? (graph.nodes.find((n) => n.id === sim.bottleneckId)?.name ?? null) : null,
      failedComponent: s.failure && sim.failure ? sim.failure.nodeName : null,
    });
  }

  if (errors.length === 0 && def.requiredOnEveryPath.length > 0) {
    for (const kind of def.requiredOnEveryPath) {
      if (bypassesKinds(graph, [kind])) errors.push(`Every request path must pass through a ${kind} component before reaching the database.`);
    }
  }

  const valid = errors.length === 0;
  const criteria: CriterionResult[] = def.criteria.map((c) => {
    const value = valid ? metricValue(c, costUsd, results) : c.metric === 'costUsd' ? costUsd : null;
    return {
      id: c.id,
      label: c.label,
      category: c.category,
      metric: c.metric,
      scenarioId: c.scenarioId ?? null,
      unit: c.unit,
      better: c.better,
      value,
      targets: c.tiers,
      passed: [meets(c, value, c.tiers[0]), meets(c, value, c.tiers[1]), meets(c, value, c.tiers[2])],
      normalized: normalize(c, value),
      weight: c.weight,
    };
  });

  const allPass = (tier: 0 | 1 | 2) => valid && criteria.every((c) => c.passed[tier]);
  const stars = (allPass(0) ? 1 + (allPass(1) ? 1 + (allPass(2) ? 1 : 0) : 0) : 0) as 0 | 1 | 2 | 3;
  const weightSum = criteria.reduce((t, c) => t + c.weight, 0) || 1;
  const score = valid ? round((criteria.reduce((t, c) => t + c.weight * c.normalized, 0) / weightSum) * 100) : 0;

  const primary = results.get(def.primaryScenarioId);
  const failure = def.failureScenarioId ? results.get(def.failureScenarioId) : undefined;
  const feedback: string[] = [];
  if (!valid) feedback.push(...errors);
  else {
    for (const [i, c] of criteria.entries()) {
      const def1 = def.criteria[i]!;
      if (!c.passed[0]) {
        const shown = c.value === null ? 'unavailable' : `${c.value} ${c.unit}`;
        feedback.push(`${c.label}: ${shown} misses the 1-star requirement of ${c.targets[0]} ${c.unit}. ${def1.hint}`);
      }
    }
    if (stars > 0 && stars < 3) {
      const tier = stars as 1 | 2;
      const missing = criteria.filter((c) => !c.passed[tier]).map((c) => `${c.label} (needs ${c.targets[tier]} ${c.unit})`);
      feedback.push(`To earn ${stars + 1} stars improve: ${missing.join('; ')}.`);
    }
    for (const s of scenarios) {
      if (stars === 0 && s.bottleneck && (s.servedPct ?? 100) < 100) feedback.push(`${s.label}: ${s.bottleneck} is the tightest component.`);
    }
  }

  return {
    challengeId: def.id,
    challengeVersion: def.version,
    simVersion: SIM_VERSION,
    judgeVersion: JUDGE_VERSION,
    valid,
    errors,
    stars,
    score,
    scenarios,
    criteria,
    summary: {
      costUsd,
      latencyMs: primary?.sim.ok && primary.sim.tailLatencyMs !== null ? round(primary.sim.tailLatencyMs, 1) : null,
      availabilityPct: primary?.sim.ok ? pct(primary.sim.availability) : null,
      failureServedPct: failure?.effective ? pct(failure.effective.servedRatio) : null,
    },
    feedback,
  };
}
