import type { Graph, GraphEdge, GraphNode, ValidationIssue } from '../model/types.ts';
import { NODE_SPECS } from '../model/defaults.ts';

export interface OutLink {
  edgeId: string;
  target: string;
  /** Normalized share (sums to 1 across a node's out-links). */
  p: number;
}

export interface Topology {
  nodes: GraphNode[];
  byId: Record<string, GraphNode>;
  /** Node ids in dependency order (sources first). */
  order: string[];
  out: Record<string, OutLink[]>;
  clients: GraphNode[];
  /** Normalized traffic share per client id. */
  clientShare: Record<string, number>;
}

export class GraphError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(issues.map((i) => i.message).join('; '));
    this.name = 'GraphError';
    this.issues = issues;
  }
}

/** Kahn's algorithm. Returns the order and any nodes left in cycles. */
export function topoSort(nodes: GraphNode[], edges: GraphEdge[]): { order: string[]; cyclic: string[] } {
  const ids = new Set(nodes.map((n) => n.id));
  const indeg: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  for (const n of nodes) {
    indeg[n.id] = 0;
    adj[n.id] = [];
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    adj[e.source]!.push(e.target);
    indeg[e.target]! += 1;
  }
  const queue = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const t of adj[id]!) {
      indeg[t]! -= 1;
      if (indeg[t] === 0) queue.push(t);
    }
  }
  const done = new Set(order);
  return { order, cyclic: nodes.filter((n) => !done.has(n.id)).map((n) => n.id) };
}

export function validateGraph(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  const byId: Record<string, GraphNode> = {};

  for (const n of graph.nodes) {
    if (ids.has(n.id)) issues.push({ severity: 'error', message: `Duplicate node id "${n.id}"`, nodeId: n.id });
    ids.add(n.id);
    byId[n.id] = n;
    const p = n.params;
    const label = n.name || n.id;
    const bad = (msg: string) => issues.push({ severity: 'error', message: `${label}: ${msg}`, nodeId: n.id });
    if (!(p.instances >= 0) || !Number.isFinite(p.instances)) bad('instances must be >= 0');
    if (!(p.capacityPerInstance >= 0) || !Number.isFinite(p.capacityPerInstance)) bad('capacity must be >= 0');
    if (!(p.latencyMs >= 0) || !Number.isFinite(p.latencyMs)) bad('latency must be >= 0');
    if (!(p.costPerInstanceHour >= 0) || !Number.isFinite(p.costPerInstanceHour)) bad('cost must be >= 0');
    if (!(p.hitRate >= 0 && p.hitRate <= 1)) bad('hit rate must be between 0 and 1');
    if (!(p.warmupSec >= 0) || !Number.isFinite(p.warmupSec)) bad('warm-up must be >= 0');
    if (!(p.queueMaxDepth >= 0) || !Number.isFinite(p.queueMaxDepth)) bad('queue depth must be >= 0');
    if (n.kind === 'client' && !(p.trafficShare >= 0)) bad('traffic share must be >= 0');
    const a = p.autoscale;
    if (a.enabled) {
      if (!NODE_SPECS[n.kind].autoscalable) bad(`${NODE_SPECS[n.kind].label} cannot autoscale`);
      if (!(a.minInstances >= 0) || !(a.maxInstances >= a.minInstances)) bad('autoscale max must be >= min');
      if (!(a.targetUtilization > 0 && a.targetUtilization <= 1)) bad('autoscale target must be in (0, 1]');
      if (!(a.provisionSec >= 0) || !(a.cooldownSec >= 0)) bad('autoscale delays must be >= 0');
    }
  }

  const edgeIds = new Set<string>();
  const seenPairs = new Set<string>();
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) issues.push({ severity: 'error', message: `Duplicate edge id "${e.id}"`, edgeId: e.id });
    edgeIds.add(e.id);
    const src = byId[e.source];
    const dst = byId[e.target];
    if (!src || !dst) {
      issues.push({ severity: 'error', message: `Edge "${e.id}" references a missing node`, edgeId: e.id });
      continue;
    }
    if (e.source === e.target) {
      issues.push({ severity: 'error', message: `${src.name} cannot connect to itself`, edgeId: e.id });
    }
    if (!NODE_SPECS[dst.kind].acceptsInput) {
      issues.push({ severity: 'error', message: `${dst.name} cannot receive traffic`, edgeId: e.id });
    }
    if (!(e.ratio >= 0) || !Number.isFinite(e.ratio)) {
      issues.push({ severity: 'error', message: `Edge ${src.name} → ${dst.name} has an invalid ratio`, edgeId: e.id });
    }
    const pair = `${e.source}>${e.target}`;
    if (seenPairs.has(pair)) {
      issues.push({ severity: 'warning', message: `Duplicate edge ${src.name} → ${dst.name}`, edgeId: e.id });
    }
    seenPairs.add(pair);
  }

  const clients = graph.nodes.filter((n) => n.kind === 'client');
  if (clients.length === 0) {
    issues.push({ severity: 'error', message: 'Add at least one Clients node to generate traffic' });
  }

  const { cyclic } = topoSort(graph.nodes, graph.edges);
  if (cyclic.length > 0) {
    const names = cyclic.map((id) => byId[id]?.name ?? id).join(', ');
    issues.push({ severity: 'error', message: `The graph contains a cycle (${names}); simulations require a DAG` });
  }

  // Reachability warnings.
  const reach = new Set<string>();
  const stack = clients.map((c) => c.id);
  const adj: Record<string, string[]> = {};
  for (const e of graph.edges) (adj[e.source] ??= []).push(e.target);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    for (const t of adj[id] ?? []) stack.push(t);
  }
  for (const n of graph.nodes) {
    if (!reach.has(n.id)) {
      issues.push({ severity: 'warning', message: `${n.name} is not reachable from any client`, nodeId: n.id });
    }
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** Validates and precomputes everything the engine needs. Throws GraphError on errors. */
export function compileGraph(graph: Graph): Topology {
  const issues = validateGraph(graph);
  if (hasErrors(issues)) throw new GraphError(issues.filter((i) => i.severity === 'error'));

  const byId: Record<string, GraphNode> = {};
  for (const n of graph.nodes) byId[n.id] = n;

  const { order } = topoSort(graph.nodes, graph.edges);
  const outEdges: Record<string, GraphEdge[]> = {};
  for (const e of graph.edges) (outEdges[e.source] ??= []).push(e);

  const out: Record<string, OutLink[]> = {};
  for (const n of graph.nodes) {
    const edges = outEdges[n.id] ?? [];
    const total = edges.reduce((s, e) => s + e.ratio, 0);
    out[n.id] = edges.map((e) => ({
      edgeId: e.id,
      target: e.target,
      p: total > 0 ? e.ratio / total : 1 / edges.length,
    }));
  }

  const clients = graph.nodes.filter((n) => n.kind === 'client');
  const shareTotal = clients.reduce((s, c) => s + c.params.trafficShare, 0);
  const clientShare: Record<string, number> = {};
  for (const c of clients) {
    clientShare[c.id] = shareTotal > 0 ? c.params.trafficShare / shareTotal : 1 / clients.length;
  }

  return { nodes: graph.nodes, byId, order, out, clients, clientShare };
}
