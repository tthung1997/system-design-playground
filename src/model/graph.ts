import type { Graph, ValidationIssue } from './types.ts';

/** Ids of components reachable from any client by following connections. */
export function reachableNodeIds(graph: Graph): Set<string> {
  const adj: Record<string, string[]> = {};
  for (const e of graph.edges) (adj[e.source] ??= []).push(e.target);
  const reach = new Set<string>();
  const stack = graph.nodes.filter((n) => n.kind === 'client').map((n) => n.id);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    stack.push(...(adj[id] ?? []));
  }
  return reach;
}

/** Connections that carry traffic from a client, i.e. the ones worth animating. */
export function flowingEdgeIds(graph: Graph): Set<string> {
  const reach = reachableNodeIds(graph);
  return new Set(graph.edges.filter((e) => reach.has(e.source)).map((e) => e.id));
}

export function validateGraph(graph: Graph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (graph.nodes.length > 0 && !graph.nodes.some((n) => n.kind === 'client')) {
    issues.push({ severity: 'warning', message: 'Add a Clients component so traffic has somewhere to start.' });
    return issues;
  }
  const reach = reachableNodeIds(graph);
  for (const n of graph.nodes) {
    if (!reach.has(n.id)) {
      issues.push({ severity: 'warning', message: `${n.name} is not reachable from any client.`, nodeId: n.id });
    }
  }
  return issues;
}
