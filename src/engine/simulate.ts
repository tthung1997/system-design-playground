import type { Graph, NodeMetrics, Scenario, ValidationIssue } from '../model/types.ts';
import { compileGraph, GraphError } from './graph.ts';
import { computeFlows, sustainableThroughput } from './flow.ts';
import { createRng } from './rng.ts';
import { profileRate } from './traffic.ts';
import { summarize } from './summary.ts';
import type { SimulationSummary } from './summary.ts';

export const MAX_STEPS = 50000;

export const NODE_METRIC_KEYS = [
  'arrival',
  'capacity',
  'served',
  'dropped',
  'forwarded',
  'completed',
  'utilization',
  'instances',
  'pendingInstances',
  'hitRate',
  'backlog',
  'latencyMs',
  'pathLatencyMs',
  'costPerHour',
] as const satisfies readonly (keyof NodeMetrics)[];

export type NodeSeries = Record<(typeof NODE_METRIC_KEYS)[number], Float64Array>;

export interface SimulationResult {
  scenario: Scenario;
  steps: number;
  /** Start time (seconds) of each step. */
  times: Float64Array;
  offered: Float64Array;
  completed: Float64Array;
  dropped: Float64Array;
  latencyMs: Float64Array;
  /** Maximum sustainable throughput of the architecture at each step. */
  capacity: Float64Array;
  costPerHour: Float64Array;
  cumulativeCost: Float64Array;
  bottleneck: (string | null)[];
  nodes: Record<string, NodeSeries>;
  edges: Record<string, Float64Array>;
  summary: SimulationSummary;
}

export function validateScenario(s: Scenario): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => issues.push({ severity: 'error', message });
  if (!(s.durationSec > 0) || !Number.isFinite(s.durationSec)) err('Duration must be greater than 0');
  if (!(s.stepSec > 0) || !Number.isFinite(s.stepSec)) err('Step must be greater than 0');
  if (s.durationSec > 0 && s.stepSec > 0 && Math.ceil(s.durationSec / s.stepSec) > MAX_STEPS) {
    err(`Too many steps (max ${MAX_STEPS}); increase the step size or shorten the duration`);
  }
  if (!(s.noise >= 0 && s.noise <= 1)) err('Noise must be between 0 and 1');
  return issues;
}

interface ScaleState {
  ready: number;
  pending: { readyAt: number; count: number }[];
  lastAction: number;
}

const pendingCount = (s: ScaleState) => s.pending.reduce((n, p) => n + p.count, 0);

/** Time-stepped simulation with traffic noise, queue backlogs, cache warm-up and autoscaling lag. */
export function simulate(graph: Graph, scenario: Scenario): SimulationResult {
  const scenarioIssues = validateScenario(scenario);
  if (scenarioIssues.length > 0) throw new GraphError(scenarioIssues);
  const topo = compileGraph(graph);

  const { durationSec, stepSec: dt, noise, profile } = scenario;
  const steps = Math.ceil(durationSec / dt);
  const rng = createRng(scenario.seed);

  const times = new Float64Array(steps);
  const offeredS = new Float64Array(steps);
  const completedS = new Float64Array(steps);
  const droppedS = new Float64Array(steps);
  const latencyS = new Float64Array(steps);
  const capacityS = new Float64Array(steps);
  const costS = new Float64Array(steps);
  const cumCostS = new Float64Array(steps);
  const bottleneck: (string | null)[] = new Array(steps).fill(null);

  const nodeSeries: Record<string, NodeSeries> = {};
  const state: Record<string, ScaleState> = {};
  const backlog: Record<string, number> = {};
  for (const n of topo.nodes) {
    const series = {} as NodeSeries;
    for (const k of NODE_METRIC_KEYS) series[k] = new Float64Array(steps);
    nodeSeries[n.id] = series;
    const a = n.params.autoscale;
    const initial = a.enabled
      ? Math.min(Math.max(n.params.instances, a.minInstances), a.maxInstances)
      : n.params.instances;
    state[n.id] = { ready: initial, pending: [], lastAction: 0 };
    backlog[n.id] = 0;
  }
  const edgeSeries: Record<string, Float64Array> = {};
  for (const e of graph.edges) edgeSeries[e.id] = new Float64Array(steps);

  let cumulative = 0;

  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    times[i] = t;

    for (const s of Object.values(state)) {
      while (s.pending.length > 0 && s.pending[0]!.readyAt <= t + 1e-9) {
        s.ready += s.pending.shift()!.count;
      }
    }

    const jitter = noise > 0 ? 1 + noise * (2 * rng() - 1) : 1;
    const offered = Math.max(0, profileRate(profile, t, durationSec) * jitter);

    const flows = computeFlows(topo, {
      offered,
      instances: (node) => state[node.id]!.ready,
      hitRate: (node) => {
        const w = node.params.warmupSec;
        return node.params.hitRate * (w > 0 ? Math.min(t / w, 1) : 1);
      },
      backlog: (id) => backlog[id] ?? 0,
      dt,
      transient: true,
    });

    let hourlyCost = 0;
    for (const n of topo.nodes) {
      const s = state[n.id]!;
      const m = flows.nodes[n.id]!;
      const pending = pendingCount(s);
      if (n.kind !== 'client') {
        m.pendingInstances = pending;
        m.costPerHour = (s.ready + pending) * n.params.costPerInstanceHour;
      }
      hourlyCost += m.costPerHour;
      const series = nodeSeries[n.id]!;
      for (const k of NODE_METRIC_KEYS) series[k][i] = m[k];
    }
    for (const e of graph.edges) edgeSeries[e.id]![i] = flows.edges[e.id] ?? 0;

    const sustain = sustainableThroughput(topo, flows.nodes);
    offeredS[i] = offered;
    completedS[i] = flows.completed;
    droppedS[i] = flows.dropped;
    latencyS[i] = flows.avgLatencyMs;
    capacityS[i] = sustain.maxThroughput;
    bottleneck[i] = sustain.bottleneckId;
    costS[i] = hourlyCost;
    cumulative += (hourlyCost * dt) / 3600;
    cumCostS[i] = cumulative;

    for (const id of Object.keys(backlog)) backlog[id] = flows.backlog[id] ?? 0;

    for (const n of topo.nodes) {
      const a = n.params.autoscale;
      if (!a.enabled || n.kind === 'client') continue;
      const s = state[n.id]!;
      const arrival = flows.nodes[n.id]!.arrival;
      const cap = n.params.capacityPerInstance;
      const desired =
        cap <= 0
          ? a.minInstances
          : Math.min(Math.max(Math.ceil(arrival / (cap * a.targetUtilization)), a.minInstances), a.maxInstances);
      const total = s.ready + pendingCount(s);
      if (desired > total) {
        s.pending.push({ readyAt: t + (a.provisionSec > 0 ? a.provisionSec : dt), count: desired - total });
        s.lastAction = t;
      } else if (desired < total && t - s.lastAction >= a.cooldownSec) {
        let surplus = total - desired;
        while (surplus > 0 && s.pending.length > 0) {
          const last = s.pending[s.pending.length - 1]!;
          const cut = Math.min(last.count, surplus);
          last.count -= cut;
          surplus -= cut;
          if (last.count === 0) s.pending.pop();
        }
        s.ready -= surplus;
        s.lastAction = t;
      }
    }
  }

  const result: SimulationResult = {
    scenario,
    steps,
    times,
    offered: offeredS,
    completed: completedS,
    dropped: droppedS,
    latencyMs: latencyS,
    capacity: capacityS,
    costPerHour: costS,
    cumulativeCost: cumCostS,
    bottleneck,
    nodes: nodeSeries,
    edges: edgeSeries,
    summary: undefined as unknown as SimulationSummary,
  };
  result.summary = summarize(result);
  return result;
}

export function nodeMetricsAt(result: SimulationResult, id: string, index: number): NodeMetrics | undefined {
  const series = result.nodes[id];
  if (!series) return undefined;
  const i = Math.min(Math.max(index, 0), result.steps - 1);
  const m = {} as Record<string, number>;
  for (const k of NODE_METRIC_KEYS) m[k] = series[k][i]!;
  return m as unknown as NodeMetrics;
}

export function edgeFlowAt(result: SimulationResult, id: string, index: number): number {
  const i = Math.min(Math.max(index, 0), result.steps - 1);
  return result.edges[id]?.[i] ?? 0;
}
