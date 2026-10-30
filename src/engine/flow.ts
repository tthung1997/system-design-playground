import type { GraphNode, NodeMetrics } from '../model/types.ts';
import type { Topology } from './graph.ts';

export interface FlowInputs {
  /** Total offered load across all clients (requests/second). */
  offered: number;
  /** Instances serving traffic for a node given its arrival rate. */
  instances: (node: GraphNode, arrival: number) => number;
  hitRate: (node: GraphNode) => number;
  /** Queue backlog at the start of the step (transient mode only). */
  backlog: (nodeId: string) => number;
  dt: number;
  /** false = steady state (queues saturate instead of accumulating). */
  transient: boolean;
}

export interface FlowResult {
  nodes: Record<string, NodeMetrics>;
  edges: Record<string, number>;
  /** Backlog at the end of the step. */
  backlog: Record<string, number>;
  offered: number;
  completed: number;
  dropped: number;
  avgLatencyMs: number;
}

/** Latency multiplier from load: ~1 when idle, grows sharply near saturation. */
export function loadFactor(utilization: number): number {
  const r = Math.min(Math.max(utilization, 0), 0.95);
  return 1 + (r * r) / (1 - r);
}

export function computeFlows(topo: Topology, inputs: FlowInputs): FlowResult {
  const { offered, dt, transient } = inputs;
  const inflow: Record<string, number> = {};
  const nodes: Record<string, NodeMetrics> = {};
  const edges: Record<string, number> = {};
  const backlog: Record<string, number> = {};
  const forwardFraction: Record<string, number> = {};
  let completedTotal = 0;
  let droppedTotal = 0;

  for (const id of topo.order) {
    const node = topo.byId[id]!;
    const params = node.params;
    const links = topo.out[id]!;
    const terminal = links.length === 0;
    const isClient = node.kind === 'client';

    const arrival = isClient ? offered * (topo.clientShare[id] ?? 0) : (inflow[id] ?? 0);
    const instances = isClient ? 1 : inputs.instances(node, arrival);
    const capacity = isClient ? Infinity : instances * params.capacityPerInstance;
    const hit = node.kind === 'cache' || node.kind === 'cdn' ? inputs.hitRate(node) : 0;

    let served: number;
    let dropped: number;
    let forwarded: number;
    let completed: number;
    let endBacklog = 0;
    let queueWaitMs = 0;

    if (node.kind === 'queue') {
      if (transient) {
        const start = inputs.backlog(id);
        const out = Math.min(capacity, start / dt + arrival);
        const raw = start + (arrival - out) * dt;
        endBacklog = Math.min(Math.max(raw, 0), params.queueMaxDepth);
        dropped = Math.max(0, raw - params.queueMaxDepth) / dt;
        served = arrival - dropped;
        forwarded = out;
        queueWaitMs = capacity > 0 ? (endBacklog / capacity) * 1000 : 0;
      } else {
        const out = Math.min(capacity, arrival);
        dropped = arrival - out;
        served = out;
        forwarded = out;
        const saturated = arrival > capacity;
        endBacklog = saturated ? params.queueMaxDepth : 0;
        queueWaitMs = saturated && capacity > 0 ? (params.queueMaxDepth / capacity) * 1000 : 0;
      }
      completed = terminal ? forwarded : 0;
      if (terminal) forwarded = 0;
      forwardFraction[id] = terminal ? 0 : 1;
    } else {
      served = Math.min(arrival, capacity);
      dropped = arrival - served;
      completed = terminal ? served : served * hit;
      forwarded = terminal ? 0 : served * (1 - hit);
      forwardFraction[id] = terminal ? 0 : 1 - hit;
    }
    backlog[id] = endBacklog;

    const utilization = isClient ? 0 : capacity > 0 ? arrival / capacity : arrival > 0 ? Infinity : 0;
    const latencyMs = isClient ? 0 : params.latencyMs * loadFactor(utilization) + queueWaitMs;

    for (const link of links) {
      const f = forwarded * link.p;
      edges[link.edgeId] = f;
      inflow[link.target] = (inflow[link.target] ?? 0) + f;
    }

    completedTotal += completed;
    droppedTotal += dropped;
    nodes[id] = {
      arrival,
      capacity,
      served,
      dropped,
      forwarded,
      completed,
      utilization,
      instances: isClient ? 0 : instances,
      pendingInstances: 0,
      hitRate: hit,
      backlog: endBacklog,
      latencyMs,
      pathLatencyMs: 0,
      costPerHour: isClient ? 0 : instances * params.costPerInstanceHour,
    };
  }

  // Expected latency, computed bottom-up from each node's forward fraction.
  for (let i = topo.order.length - 1; i >= 0; i--) {
    const id = topo.order[i]!;
    const m = nodes[id]!;
    let downstream = 0;
    for (const link of topo.out[id]!) downstream += link.p * nodes[link.target]!.pathLatencyMs;
    m.pathLatencyMs = m.latencyMs + (forwardFraction[id] ?? 0) * downstream;
  }
  let avgLatencyMs = 0;
  for (const c of topo.clients) avgLatencyMs += (topo.clientShare[c.id] ?? 0) * nodes[c.id]!.pathLatencyMs;

  return {
    nodes,
    edges,
    backlog,
    offered,
    completed: completedTotal,
    dropped: droppedTotal,
    avgLatencyMs,
  };
}

/**
 * Maximum offered load the topology can carry without dropping, given each node's
 * capacity and hit rate. Independent of the current load.
 */
export function sustainableThroughput(
  topo: Topology,
  metrics: Record<string, NodeMetrics>,
): { maxThroughput: number; bottleneckId: string | null } {
  const unit: Record<string, number> = {};
  let max = Infinity;
  let bottleneckId: string | null = null;

  for (const id of topo.order) {
    const node = topo.byId[id]!;
    const m = metrics[id]!;
    const links = topo.out[id]!;
    const share = node.kind === 'client' ? (topo.clientShare[id] ?? 0) : (unit[id] ?? 0);
    if (node.kind !== 'client' && share > 0 && Number.isFinite(m.capacity)) {
      const limit = m.capacity / share;
      if (limit < max) {
        max = limit;
        bottleneckId = id;
      }
    }
    const pass = links.length === 0 ? 0 : node.kind === 'queue' ? 1 : 1 - m.hitRate;
    for (const link of links) unit[link.target] = (unit[link.target] ?? 0) + share * pass * link.p;
  }
  return { maxThroughput: max, bottleneckId };
}
