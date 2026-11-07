import { createNode } from './defaults.ts';
import type { Graph, NodeConfig, NodeKind } from './types.ts';

export type NodeSeed = [id: string, kind: NodeKind, name: string, config?: NodeConfig];

/** Builds a graph with one component per row (or side by side when they share a row index). */
export function graphOf(seeds: NodeSeed[], links: [string, string][], rows?: Record<string, [row: number, col: number]>): Graph {
  const nodes = seeds.map(([id, kind, name, config], i) => {
    const [row, col] = rows?.[id] ?? [i, 0];
    const node = createNode(kind, id, { x: col * 230, y: row * 150 }, name);
    if (config) node.config = { ...config };
    return node;
  });
  return { nodes, edges: links.map(([source, target], i) => ({ id: `e${i + 1}`, source, target })) };
}
