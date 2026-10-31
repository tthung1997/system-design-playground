import { createNode } from './defaults.ts';
import type { Graph, GraphEdge, NodeKind } from './types.ts';

export interface Preset {
  id: string;
  name: string;
  description: string;
  graph: Graph;
}

type NodeSeed = [id: string, kind: NodeKind, name: string, row: number];

const ROW_HEIGHT = 150;

/** Lays components out top to bottom, one per row. */
function build(nodeSeeds: NodeSeed[], links: [string, string][]): Graph {
  const edges: GraphEdge[] = links.map(([source, target], i) => ({ id: `e${i + 1}`, source, target }));
  return {
    nodes: nodeSeeds.map(([id, kind, name, row]) => createNode(kind, id, { x: 0, y: row * ROW_HEIGHT }, name)),
    edges,
  };
}

export const PRESETS: Preset[] = [
  {
    id: 'basic-web-app',
    name: 'Basic web app',
    description: 'Clients → load balancer → services → database.',
    graph: build(
      [
        ['clients', 'client', 'Users', 0],
        ['lb', 'loadBalancer', 'Load balancer', 1],
        ['api', 'service', 'API servers', 2],
        ['db', 'database', 'Primary DB', 3],
      ],
      [
        ['clients', 'lb'],
        ['lb', 'api'],
        ['api', 'db'],
      ],
    ),
  },
  {
    id: 'cached-reads',
    name: 'CDN + cache read path',
    description: 'A CDN and a cache sit in front of the database.',
    graph: build(
      [
        ['clients', 'client', 'Users', 0],
        ['cdn', 'cdn', 'CDN', 1],
        ['lb', 'loadBalancer', 'Load balancer', 2],
        ['api', 'service', 'API servers', 3],
        ['cache', 'cache', 'Redis', 4],
        ['db', 'database', 'Primary DB', 5],
      ],
      [
        ['clients', 'cdn'],
        ['cdn', 'lb'],
        ['lb', 'api'],
        ['api', 'cache'],
        ['cache', 'db'],
      ],
    ),
  },
  {
    id: 'queue-buffer',
    name: 'Queue-buffered writes',
    description: 'A queue sits between the ingest API and the database.',
    graph: build(
      [
        ['clients', 'client', 'Writers', 0],
        ['api', 'service', 'Ingest API', 1],
        ['queue', 'queue', 'Write queue', 2],
        ['db', 'database', 'Primary DB', 3],
      ],
      [
        ['clients', 'api'],
        ['api', 'queue'],
        ['queue', 'db'],
      ],
    ),
  },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
