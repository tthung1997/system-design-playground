import { CONFIG_FIELDS, MAX_REPLICAS, SIZE_TIERS, workloadError } from '../model/defaults.ts';
import type { Graph, GraphNode, Workload } from '../model/types.ts';
import {
  CACHE_TIERS,
  CDN,
  DATABASE_TIERS,
  LOAD_BALANCER,
  MAX_QUEUEING_UTILIZATION,
  monthlyCost,
  QUEUE_TIERS,
  REPLICA_AVAILABILITY,
  resolveConfig,
  SERVICE_TIERS,
} from './catalog.ts';

export interface SimIssue {
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
}

export interface NodeDiagnostics {
  /** Requests per second offered to the component (reads + writes). */
  arrivalRps: number;
  servedRps: number;
  capacityRps: number;
  /** Offered load divided by capacity; above 1 the component drops requests. */
  utilization: number;
  saturated: boolean;
}

export interface QueueResult {
  nodeId: string;
  arrivalRps: number;
  drainRps: number;
  maxBacklog: number;
  lostMessages: number;
  /** Seconds after the traffic stops until the backlog is empty; null if it can never drain. */
  drainSeconds: number | null;
}

/** Metrics for one run. Latencies are model estimates, not measurements. */
export interface RunMetrics {
  /** Share of offered requests that complete (0..1). Null when the design cannot be simulated. */
  servedRatio: number | null;
  meanLatencyMs: number | null;
  /** Latency of the slowest path that carries traffic (for example a cache miss); a tail proxy, not a percentile. */
  tailLatencyMs: number | null;
  /** Modeled probability a request succeeds given independent replica failures (0..1). */
  availability: number | null;
  queue: QueueResult | null;
}

export interface FailureResult extends RunMetrics {
  nodeId: string;
  nodeName: string;
}

export interface SimResult extends RunMetrics {
  ok: boolean;
  issues: SimIssue[];
  offeredRps: number;
  monthlyCostUsd: number;
  nodes: Record<string, NodeDiagnostics>;
  /** Requests per second carried by each connection. */
  edges: Record<string, number>;
  bottleneckId: string | null;
  /** Worst result when one replica of any single component fails; only set when requested. */
  failure: FailureResult | null;
}

export interface SimOptions {
  failure?: 'none' | 'worst-single-replica';
}

const EPS = 1e-9;

interface Index {
  nodes: Map<string, GraphNode>;
  out: Map<string, string[]>;
  inn: Map<string, string[]>;
  order: string[];
  reachable: Set<string>;
}

function buildIndex(graph: Graph): { index: Index | null; issues: SimIssue[] } {
  const issues: SimIssue[] = [];
  const nodes = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (nodes.has(n.id)) issues.push({ severity: 'error', message: `Duplicate component id "${n.id}".` });
    nodes.set(n.id, n);
  }
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const id of nodes.keys()) {
    out.set(id, []);
    inn.set(id, []);
  }
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) {
      issues.push({ severity: 'error', message: `Connection ${e.id} references a missing component.` });
      continue;
    }
    if (e.source === e.target) {
      issues.push({ severity: 'error', message: `${nodes.get(e.source)!.name} is connected to itself.`, nodeId: e.source });
      continue;
    }
    const key = `${e.source}>${e.target}`;
    if (seen.has(key)) {
      issues.push({ severity: 'error', message: `Duplicate connection ${nodes.get(e.source)!.name} → ${nodes.get(e.target)!.name}.` });
      continue;
    }
    seen.add(key);
    out.get(e.source)!.push(e.target);
    inn.get(e.target)!.push(e.source);
  }
  for (const list of out.values()) list.sort();
  for (const list of inn.values()) list.sort();

  // Kahn's algorithm, always taking the smallest id so the order never depends on array order.
  const indegree = new Map<string, number>();
  for (const [id, list] of inn) indegree.set(id, list.length);
  const ready = [...nodes.keys()].filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const t of out.get(id)!) {
      const d = indegree.get(t)! - 1;
      indegree.set(t, d);
      if (d === 0) {
        ready.push(t);
        ready.sort();
      }
    }
  }
  if (order.length !== nodes.size) {
    issues.push({ severity: 'error', message: 'The diagram contains a cycle; traffic must flow one way.' });
    return { index: null, issues };
  }

  const reachable = new Set<string>();
  const stack = [...nodes.values()].filter((n) => n.kind === 'client').map((n) => n.id);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    stack.push(...out.get(id)!);
  }
  return { index: { nodes, out, inn, order, reachable }, issues };
}

function downstreamOf(index: Index, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...index.out.get(id)!];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...index.out.get(n)!);
  }
  return seen;
}

/** Checks the diagram independently of any workload. */
export function validateTopology(graph: Graph): SimIssue[] {
  const { index, issues } = buildIndex(graph);
  if (!index) return issues;
  const { nodes, out, inn, reachable } = index;
  const clients = [...nodes.values()].filter((n) => n.kind === 'client');
  if (clients.length === 0) {
    issues.push({ severity: 'error', message: 'Add a Clients component so traffic has somewhere to start.' });
    return issues;
  }
  if (clients.length > 1) {
    issues.push({ severity: 'error', message: 'Simulation supports a single Clients component; merge them into one.' });
  }

  for (const n of graph.nodes) {
    const cfg = n.config;
    if (cfg?.replicas !== undefined) {
      if (!CONFIG_FIELDS[n.kind].replicas) {
        issues.push({ severity: 'error', message: `${n.name} does not support replicas.`, nodeId: n.id });
      } else if (!Number.isInteger(cfg.replicas) || cfg.replicas < 1 || cfg.replicas > MAX_REPLICAS) {
        issues.push({ severity: 'error', message: `${n.name} needs a whole number of replicas from 1 to ${MAX_REPLICAS}.`, nodeId: n.id });
      }
    }
    if (cfg?.size !== undefined && (!CONFIG_FIELDS[n.kind].size || !SIZE_TIERS.includes(cfg.size))) {
      issues.push({ severity: 'error', message: `${n.name} has an unsupported size.`, nodeId: n.id });
    }
  }

  for (const n of graph.nodes) {
    if (!reachable.has(n.id)) {
      issues.push({ severity: 'warning', message: `${n.name} is not reachable from the clients; it adds cost but carries no traffic.`, nodeId: n.id });
      continue;
    }
    const targets = out.get(n.id)!;
    if (targets.length > 1 && n.kind !== 'loadBalancer' && n.kind !== 'client') {
      issues.push({
        severity: 'error',
        message: `${n.name} connects to ${targets.length} components. Only load balancers (and clients) can split traffic; chain components instead.`,
        nodeId: n.id,
      });
    }
    if (targets.length === 0 && n.kind !== 'database') {
      issues.push({
        severity: 'error',
        message:
          n.kind === 'client'
            ? 'Clients are not connected to anything.'
            : `${n.name} is a dead end: requests cannot complete. Every path must finish at a database.`,
        nodeId: n.id,
      });
    }
    if (targets.length > 0 && n.kind === 'database') {
      issues.push({ severity: 'error', message: `${n.name} is a data store and cannot forward traffic.`, nodeId: n.id });
    }
  }

  const queues = [...nodes.values()].filter((n) => n.kind === 'queue' && reachable.has(n.id));
  if (queues.length > 1) {
    issues.push({ severity: 'error', message: 'Simulation supports one queue per design.' });
  }
  for (const q of queues) {
    const down = downstreamOf(index, q.id);
    for (const id of down) {
      const outsider = inn.get(id)!.find((p) => p !== q.id && !down.has(p) && reachable.has(p));
      if (outsider) {
        issues.push({
          severity: 'error',
          message: `${nodes.get(id)!.name} receives both queued and direct traffic; keep consumers of ${q.name} separate.`,
          nodeId: id,
        });
      }
    }
  }
  return issues;
}

/** P(at least k of n independent replicas are up). */
function atLeast(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (n < k) return 0;
  let total = 0;
  let coef = 1; // C(n, i), built incrementally
  for (let i = 0; i <= n; i++) {
    if (i > 0) coef = (coef * (n - i + 1)) / i;
    if (i >= k) total += coef * p ** i * (1 - p) ** (n - i);
  }
  return Math.min(1, total);
}

interface NodeRun {
  arrR: number;
  arrW: number;
  accR: number;
  accW: number;
  servedR: number;
  servedW: number;
  outR: number;
  outW: number;
  capacity: number;
  utilization: number;
  /** Local latency for reads / writes, including the queueing delay. */
  msR: number;
  msW: number;
  hit: number;
  avail: number;
}

interface Agg {
  s: number;
  m: number;
  t: number | null;
  a: number;
}

interface RunOutput extends RunMetrics {
  errors: SimIssue[];
  runs: Map<string, NodeRun>;
  edges: Record<string, number>;
}

const queueFactor = (util: number) => 1 / (1 - Math.min(util, MAX_QUEUEING_UTILIZATION));
const accept = (arrival: number, capacity: number) => (arrival <= capacity * (1 + EPS) || arrival === 0 ? 1 : capacity / arrival);

function replicasOf(node: GraphNode, failedId: string | null): number {
  const r = resolveConfig(node).replicas;
  return node.id === failedId ? Math.max(0, r - 1) : r;
}

/** Writes per second a component can sustain (used to find how fast a queue can drain). */
function writeCapacity(node: GraphNode, failedId: string | null): number {
  const { size } = resolveConfig(node);
  const replicas = replicasOf(node, failedId);
  switch (node.kind) {
    case 'service':
      return SERVICE_TIERS[size].capacityRps * replicas;
    case 'loadBalancer':
      return LOAD_BALANCER.capacityRps * replicas;
    case 'cache':
      return CACHE_TIERS[size].capacityRps * replicas;
    case 'database':
      return replicas > 0 ? DATABASE_TIERS[size].writeRps : 0;
    case 'cdn':
      return CDN.capacityRps;
    default:
      return Infinity;
  }
}

function run(index: Index, workload: Workload, failedId: string | null): RunOutput {
  const { nodes, out, order } = index;
  const runs = new Map<string, NodeRun>();
  const arrival = new Map<string, { r: number; w: number }>();
  for (const id of order) arrival.set(id, { r: 0, w: 0 });
  const edges: Record<string, number> = {};
  const errors: SimIssue[] = [];
  let queue: QueueResult | null = null;
  const edgeId = (s: string, t: string) => `${s}>${t}`;

  const forward = (id: string, outR: number, outW: number, kids: string[]) => {
    const split = kids.length;
    for (const k of kids) {
      const a = arrival.get(k)!;
      a.r += outR / split;
      a.w += outW / split;
      edges[edgeId(id, k)] = (outR + outW) / split;
    }
  };

  for (const id of order) {
    const node = nodes.get(id)!;
    const a = arrival.get(id)!;
    const kids = out.get(id)!;
    const { size } = resolveConfig(node);
    const replicas = replicasOf(node, failedId);
    const total = a.r + a.w;
    const blank: NodeRun = {
      arrR: a.r, arrW: a.w, accR: 1, accW: 1, servedR: a.r, servedW: a.w, outR: a.r, outW: a.w,
      capacity: Infinity, utilization: 0, msR: 0, msW: 0, hit: 0, avail: 1,
    };
    let r = blank;
    const avail = (perReplicaCapacity: number, load: number) => {
      const p = REPLICA_AVAILABILITY[node.kind];
      const needed = load > 0 ? Math.max(1, Math.ceil(load / perReplicaCapacity - EPS)) : 1;
      return atLeast(replicasOf(node, null), needed, p);
    };

    switch (node.kind) {
      case 'client': {
        r = { ...blank, arrR: 0, arrW: 0, servedR: 0, servedW: 0, outR: workload.rps * workload.readRatio, outW: workload.rps * (1 - workload.readRatio) };
        break;
      }
      case 'service':
      case 'loadBalancer': {
        const perReplica = node.kind === 'service' ? SERVICE_TIERS[size].capacityRps : LOAD_BALANCER.capacityRps;
        const base = node.kind === 'service' ? SERVICE_TIERS[size].latencyMs : LOAD_BALANCER.latencyMs;
        const capacity = perReplica * replicas;
        const acc = capacity <= 0 ? (total > 0 ? 0 : 1) : accept(total, capacity);
        const util = capacity > 0 ? total / capacity : total > 0 ? Infinity : 0;
        const ms = base * queueFactor(util);
        r = {
          ...blank, accR: acc, accW: acc, servedR: a.r * acc, servedW: a.w * acc, outR: a.r * acc, outW: a.w * acc,
          capacity, utilization: util, msR: ms, msW: ms, avail: avail(perReplica, total),
        };
        break;
      }
      case 'cdn':
      case 'cache': {
        const t = node.kind === 'cdn' ? CDN : CACHE_TIERS[size];
        const capacity = t.capacityRps * (node.kind === 'cache' ? replicas : 1);
        const acc = capacity <= 0 ? (total > 0 ? 0 : 1) : accept(total, capacity);
        const util = capacity > 0 ? total / capacity : total > 0 ? Infinity : 0;
        const ms = t.latencyMs * queueFactor(util);
        r = {
          ...blank, accR: acc, accW: acc, servedR: a.r * acc, servedW: a.w * acc,
          outR: a.r * acc * (1 - t.hitRatio), outW: a.w * acc, capacity, utilization: util,
          msR: ms, msW: ms, hit: t.hitRatio,
          avail: node.kind === 'cdn' ? REPLICA_AVAILABILITY.cdn : avail(t.capacityRps, total),
        };
        break;
      }
      case 'database': {
        const t = DATABASE_TIERS[size];
        const capR = t.readRps * replicas;
        const capW = replicas > 0 ? t.writeRps : 0;
        const accR = capR <= 0 ? (a.r > 0 ? 0 : 1) : accept(a.r, capR);
        const accW = capW <= 0 ? (a.w > 0 ? 0 : 1) : accept(a.w, capW);
        const uR = capR > 0 ? a.r / capR : a.r > 0 ? Infinity : 0;
        const uW = capW > 0 ? a.w / capW : a.w > 0 ? Infinity : 0;
        r = {
          ...blank, accR, accW, servedR: a.r * accR, servedW: a.w * accW, outR: 0, outW: 0,
          capacity: capR, utilization: Math.max(uR, uW),
          msR: t.readMs * queueFactor(uR), msW: t.writeMs * queueFactor(uW),
          avail: avail(t.readRps, a.r),
        };
        break;
      }
      case 'queue': {
        const t = QUEUE_TIERS[size];
        if (a.r > 0) {
          errors.push({ severity: 'error', message: `${node.name} receives read traffic; queues only buffer writes, so use a write-only workload.`, nodeId: id });
        }
        const acc = accept(a.w, t.enqueueRps);
        const lambda = a.w * acc;
        const util = a.w / t.enqueueRps;

        // Unit shares of queue output reaching each consumer decide how fast the backlog drains.
        const shares = new Map<string, number>();
        for (const k of kids) shares.set(k, 1 / kids.length);
        for (const n of order) {
          const share = shares.get(n);
          if (share === undefined) continue;
          const nk = out.get(n)!;
          const per = nk.length > 0 ? (nodes.get(n)!.kind === 'loadBalancer' ? 1 / nk.length : 1) : 0;
          for (const k of nk) shares.set(k, (shares.get(k) ?? 0) + share * per);
        }
        let drain = Infinity;
        for (const [n, share] of shares) {
          if (share <= 0) continue;
          drain = Math.min(drain, writeCapacity(nodes.get(n)!, failedId) / share);
        }
        const duration = workload.durationSec;
        const accumulated = lambda > drain ? (lambda - drain) * duration : 0;
        const stored = Math.min(accumulated, t.maxBacklog);
        const lost = accumulated - stored;
        const queueLostFraction = lambda > 0 ? lost / (lambda * duration) : 0;
        queue = {
          nodeId: id,
          arrivalRps: lambda,
          drainRps: Number.isFinite(drain) ? drain : lambda,
          maxBacklog: stored,
          lostMessages: lost,
          drainSeconds: stored === 0 ? 0 : drain > 0 ? stored / drain : null,
        };
        const served = lambda * (1 - queueLostFraction);
        r = {
          ...blank, accW: a.w > 0 ? served / a.w : 1, servedW: served, servedR: 0,
          outR: 0, outW: Math.min(lambda, drain), capacity: t.enqueueRps, utilization: util,
          msW: t.ackMs * queueFactor(util), msR: t.ackMs * queueFactor(util),
          avail: REPLICA_AVAILABILITY.queue,
        };
        break;
      }
    }
    runs.set(id, r);
    if (kids.length > 0) forward(id, r.outR, r.outW, kids);
  }

  // Backward pass: success, latency and availability per request class.
  const aggs = { r: new Map<string, Agg>(), w: new Map<string, Agg>() };
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const node = nodes.get(id)!;
    const run1 = runs.get(id)!;
    const kids = out.get(id)!;
    for (const c of ['r', 'w'] as const) {
      const down = (): Agg => {
        if (kids.length === 0) return { s: 1, m: 0, t: 0, a: 1 };
        const list = kids.map((k) => aggs[c].get(k)!).map((g, idx) => {
          const kr = runs.get(kids[idx]!)!;
          return { g, flows: (c === 'r' ? kr.arrR : kr.arrW) > EPS };
        });
        const sSum = list.reduce((x, y) => x + y.g.s, 0);
        const tails = list.filter((y) => y.flows && y.g.t !== null && y.g.s > 0).map((y) => y.g.t!);
        return {
          s: sSum / list.length,
          a: list.reduce((x, y) => x + y.g.a, 0) / list.length,
          m: sSum > 0 ? list.reduce((x, y) => x + y.g.s * y.g.m, 0) / sSum : 0,
          t: tails.length > 0 ? Math.max(...tails) : list.some((y) => y.g.s > 0) ? 0 : null,
        };
      };
      const acc = c === 'r' ? run1.accR : run1.accW;
      const ms = c === 'r' ? run1.msR : run1.msW;
      let agg: Agg;
      if (node.kind === 'client') {
        agg = down();
      } else if (node.kind === 'database') {
        agg = { s: acc, m: acc > 0 ? ms : 0, t: acc > 0 ? ms : null, a: run1.avail };
      } else if (node.kind === 'queue') {
        agg = { s: acc, m: acc > 0 ? ms : 0, t: acc > 0 ? ms : null, a: run1.avail };
      } else if (c === 'r' && (node.kind === 'cache' || node.kind === 'cdn')) {
        const d = down();
        const h = run1.hit;
        const denom = h + (1 - h) * d.s;
        const needsDown = (1 - h) > 0 && d.s > 0;
        const s = acc * denom;
        agg = {
          s,
          m: s > 0 ? ms + ((1 - h) * d.s * d.m) / denom : 0,
          t: s > 0 ? ms + (needsDown ? (d.t ?? 0) : 0) : null,
          a: run1.avail * (h + (1 - h) * d.a),
        };
      } else {
        const d = down();
        const s = acc * d.s;
        agg = { s, m: s > 0 ? ms + d.m : 0, t: s > 0 && d.t !== null ? ms + d.t : null, a: run1.avail * d.a };
      }
      aggs[c].set(id, agg);
    }
  }

  const clientId = order.find((id) => nodes.get(id)!.kind === 'client')!;
  const offR = workload.rps * workload.readRatio;
  const offW = workload.rps - offR;
  const aR = aggs.r.get(clientId)!;
  const aW = aggs.w.get(clientId)!;
  const servedRps = offR * aR.s + offW * aW.s;
  const classes = [
    { off: offR, g: aR },
    { off: offW, g: aW },
  ].filter((x) => x.off > EPS);
  const tails = classes.filter((x) => x.g.s > 0 && x.g.t !== null).map((x) => x.g.t!);
  return {
    errors,
    runs,
    edges,
    queue,
    servedRatio: workload.rps > 0 ? servedRps / workload.rps : 1,
    meanLatencyMs: servedRps > EPS ? classes.reduce((x, y) => x + y.off * y.g.s * y.g.m, 0) / servedRps : null,
    tailLatencyMs: tails.length > 0 ? Math.max(...tails) : null,
    availability: workload.rps > 0 ? (offR * aR.a + offW * aW.a) / workload.rps : 1,
  };
}

const metricsOf = (o: RunOutput): RunMetrics => ({
  servedRatio: o.servedRatio,
  meanLatencyMs: o.meanLatencyMs,
  tailLatencyMs: o.tailLatencyMs,
  availability: o.availability,
  queue: o.queue,
});

const EMPTY: RunMetrics = { servedRatio: null, meanLatencyMs: null, tailLatencyMs: null, availability: null, queue: null };

/** Orders failure outcomes: fewer served requests first, then more lost messages, a slower drain, then higher latency. */
function isWorse(a: RunMetrics, b: RunMetrics): boolean {
  const sa = a.servedRatio ?? 0;
  const sb = b.servedRatio ?? 0;
  if (Math.abs(sa - sb) > EPS) return sa < sb;
  const la = a.queue?.lostMessages ?? 0;
  const lb = b.queue?.lostMessages ?? 0;
  if (Math.abs(la - lb) > EPS) return la > lb;
  const da = a.queue ? (a.queue.drainSeconds ?? Infinity) : 0;
  const db = b.queue ? (b.queue.drainSeconds ?? Infinity) : 0;
  if (da !== db) return da > db;
  return (a.tailLatencyMs ?? 0) > (b.tailLatencyMs ?? 0) + EPS;
}

export function totalMonthlyCost(graph: Graph): number {
  return graph.nodes.reduce((sum, n) => sum + monthlyCost(n), 0);
}

/**
 * Deterministic, closed-form estimate of how a design behaves under a workload. The result never
 * depends on the order of nodes or connections.
 */
export function simulate(graph: Graph, workload: Workload, options: SimOptions = {}): SimResult {
  const monthlyCostUsd = totalMonthlyCost(graph);
  const issues = validateTopology(graph);
  const problem = workloadError(workload);
  if (problem) issues.push({ severity: 'error', message: problem });
  const invalid = (extra: SimIssue[] = []): SimResult => ({
    ...EMPTY,
    ok: false,
    issues: [...issues, ...extra],
    offeredRps: workload.rps,
    monthlyCostUsd,
    nodes: {},
    edges: {},
    bottleneckId: null,
    failure: null,
  });
  if (issues.some((i) => i.severity === 'error')) return invalid();

  const { index } = buildIndex(graph);
  if (!index) return invalid();
  const base = run(index, workload, null);
  if (base.errors.length > 0) return invalid(base.errors);

  const nodes: Record<string, NodeDiagnostics> = {};
  let bottleneckId: string | null = null;
  let worst = -1;
  for (const id of index.order) {
    const r = base.runs.get(id)!;
    const node = index.nodes.get(id)!;
    if (node.kind === 'client') continue;
    const arrivalRps = r.arrR + r.arrW;
    nodes[id] = {
      arrivalRps,
      servedRps: r.servedR + r.servedW,
      capacityRps: r.capacity,
      utilization: r.utilization,
      saturated: r.accR < 1 - EPS || r.accW < 1 - EPS,
    };
    if (arrivalRps > EPS && r.utilization > worst) {
      worst = r.utilization;
      bottleneckId = id;
    }
  }

  let failure: FailureResult | null = null;
  if (options.failure === 'worst-single-replica') {
    for (const id of [...index.order].sort()) {
      const node = index.nodes.get(id)!;
      const r = base.runs.get(id)!;
      if (!CONFIG_FIELDS[node.kind].replicas || r.arrR + r.arrW <= EPS) continue;
      const m = metricsOf(run(index, workload, id));
      if (!failure || isWorse(m, failure)) failure = { ...m, nodeId: id, nodeName: node.name };
    }
  }

  return {
    ...metricsOf(base),
    ok: true,
    issues,
    offeredRps: workload.rps,
    monthlyCostUsd,
    nodes,
    edges: Object.fromEntries(graph.edges.map((e) => [e.id, base.edges[`${e.source}>${e.target}`] ?? 0])),
    bottleneckId,
    failure,
  };
}
