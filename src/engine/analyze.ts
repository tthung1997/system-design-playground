import type { Analysis, Graph, GraphNode } from '../model/types.ts';
import { compileGraph } from './graph.ts';
import type { Topology } from './graph.ts';
import { computeFlows, sustainableThroughput } from './flow.ts';

/** Instances an autoscaler converges to for a steady arrival rate. */
export function steadyInstances(node: GraphNode, arrival: number): number {
  const { autoscale: a, capacityPerInstance, instances } = node.params;
  if (!a.enabled) return instances;
  if (capacityPerInstance <= 0) return a.minInstances;
  const desired = Math.ceil(arrival / (capacityPerInstance * a.targetUtilization));
  return Math.min(Math.max(desired, a.minInstances), a.maxInstances);
}

export function analyzeTopology(topo: Topology, offeredRps: number): Analysis {
  const flows = computeFlows(topo, {
    offered: offeredRps,
    instances: steadyInstances,
    hitRate: (n) => n.params.hitRate,
    backlog: () => 0,
    dt: 1,
    transient: false,
  });

  const { maxThroughput, bottleneckId } = sustainableThroughput(topo, flows.nodes);
  const saturatedIds = topo.order.filter((id) => {
    const m = flows.nodes[id]!;
    return m.dropped > 1e-9 || m.utilization >= 1;
  });
  let costPerHour = 0;
  for (const m of Object.values(flows.nodes)) costPerHour += m.costPerHour;

  return {
    nodes: flows.nodes,
    edges: flows.edges,
    offered: offeredRps,
    completed: flows.completed,
    dropped: flows.dropped,
    successRate: offeredRps > 0 ? flows.completed / offeredRps : 1,
    avgLatencyMs: flows.avgLatencyMs,
    costPerHour,
    maxThroughput,
    headroom: offeredRps > 0 ? maxThroughput / offeredRps : Infinity,
    bottleneckId,
    saturatedIds,
  };
}

/** Steady-state analysis of the graph at a constant offered load. Throws GraphError if invalid. */
export function analyze(graph: Graph, offeredRps: number): Analysis {
  return analyzeTopology(compileGraph(graph), offeredRps);
}
