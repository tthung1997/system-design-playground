import { useMemo } from 'react';
import { analyze, edgeFlowAt, hasErrors, nodeMetricsAt, peakRate, validateGraph } from '../engine/index.ts';
import type { Analysis, NodeMetrics, ValidationIssue } from '../model/types.ts';
import { useStore } from '../store/useStore.ts';

export interface View {
  mode: 'static' | 'simulation';
  nodes: Record<string, NodeMetrics>;
  edges: Record<string, number>;
  offered: number;
  completed: number;
  dropped: number;
  latencyMs: number;
  costPerHour: number;
  capacity: number;
  bottleneckId: string | null;
  /** Simulation time at the cursor, in seconds. */
  time: number;
}

export interface Derived {
  issues: ValidationIssue[];
  valid: boolean;
  analysis: Analysis | null;
  peak: number;
  view: View | null;
}

/** Combines validation, the steady-state peak-load analysis and the current simulation frame. */
export function useDerived(): Derived {
  const graph = useStore((s) => s.graph);
  const scenario = useStore((s) => s.scenario);
  const result = useStore((s) => s.result);
  const cursor = useStore((s) => s.cursor);

  const issues = useMemo(() => validateGraph(graph), [graph]);
  const valid = !hasErrors(issues);
  const peak = useMemo(() => peakRate(scenario), [scenario]);
  const analysis = useMemo(() => (valid ? analyze(graph, peak) : null), [valid, graph, peak]);

  const view = useMemo<View | null>(() => {
    if (result) {
      const i = Math.min(cursor, result.steps - 1);
      const nodes: Record<string, NodeMetrics> = {};
      for (const id of Object.keys(result.nodes)) nodes[id] = nodeMetricsAt(result, id, i)!;
      const edges: Record<string, number> = {};
      for (const id of Object.keys(result.edges)) edges[id] = edgeFlowAt(result, id, i);
      return {
        mode: 'simulation',
        nodes,
        edges,
        offered: result.offered[i]!,
        completed: result.completed[i]!,
        dropped: result.dropped[i]!,
        latencyMs: result.latencyMs[i]!,
        costPerHour: result.costPerHour[i]!,
        capacity: result.capacity[i]!,
        bottleneckId: result.bottleneck[i] ?? null,
        time: result.times[i]!,
      };
    }
    if (!analysis) return null;
    return {
      mode: 'static',
      nodes: analysis.nodes,
      edges: analysis.edges,
      offered: analysis.offered,
      completed: analysis.completed,
      dropped: analysis.dropped,
      latencyMs: analysis.avgLatencyMs,
      costPerHour: analysis.costPerHour,
      capacity: analysis.maxThroughput,
      bottleneckId: analysis.bottleneckId,
      time: 0,
    };
  }, [result, cursor, analysis]);

  return { issues, valid, analysis, peak, view };
}
