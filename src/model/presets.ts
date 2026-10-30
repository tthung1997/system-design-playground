import { createNode, DEFAULT_SCENARIO } from './defaults.ts';
import type { Graph, GraphEdge, GraphNode, NodeKind, NodeParams, Scenario } from './types.ts';

export interface Preset {
  id: string;
  name: string;
  description: string;
  graph: Graph;
  scenario: Scenario;
}

type NodeSeed = [id: string, kind: NodeKind, name: string, x: number, y: number, overrides?: Partial<NodeParams>];

function build(nodeSeeds: NodeSeed[], links: [string, string, number?][]): Graph {
  const nodes: GraphNode[] = nodeSeeds.map(([id, kind, name, x, y, overrides]) =>
    createNode(kind, id, { x, y }, overrides, name),
  );
  const edges: GraphEdge[] = links.map(([source, target, ratio], i) => ({
    id: `e${i + 1}`,
    source,
    target,
    ratio: ratio ?? 1,
  }));
  return { nodes, edges };
}

const X = 260;

export const PRESETS: Preset[] = [
  {
    id: 'basic-web-app',
    name: 'Basic web app',
    description: 'Clients → load balancer → services → database with a daily traffic cycle.',
    graph: build(
      [
        ['clients', 'client', 'Users', 0, 120],
        ['lb', 'loadBalancer', 'Load balancer', X, 120],
        ['api', 'service', 'API servers', X * 2, 120, { instances: 4 }],
        ['db', 'database', 'Primary DB', X * 3, 120, { instances: 2, capacityPerInstance: 1000 }],
      ],
      [
        ['clients', 'lb'],
        ['lb', 'api'],
        ['api', 'db'],
      ],
    ),
    scenario: { ...DEFAULT_SCENARIO },
  },
  {
    id: 'cached-reads',
    name: 'CDN + cache read path',
    description: 'A CDN and cache shield the database; hit rates warm up after a cold start.',
    graph: build(
      [
        ['clients', 'client', 'Users', 0, 140],
        ['cdn', 'cdn', 'CDN', X, 140, { hitRate: 0.6 }],
        ['lb', 'loadBalancer', 'Load balancer', X * 2, 140],
        ['api', 'service', 'API servers', X * 3, 140, { instances: 5 }],
        ['cache', 'cache', 'Redis', X * 4, 140, { hitRate: 0.75, instances: 2 }],
        ['db', 'database', 'Primary DB', X * 5, 140, { instances: 1 }],
      ],
      [
        ['clients', 'cdn'],
        ['cdn', 'lb'],
        ['lb', 'api'],
        ['api', 'cache'],
        ['cache', 'db'],
      ],
    ),
    scenario: {
      ...DEFAULT_SCENARIO,
      profile: { type: 'daily', baseRps: 800, peakRps: 4000, peakHour: 14 },
      durationSec: 12 * 3600,
      stepSec: 30,
    },
  },
  {
    id: 'flash-sale',
    name: 'Autoscaling flash sale',
    description: 'A sudden spike hits autoscaled services; provisioning lag causes brief drops.',
    graph: build(
      [
        ['clients', 'client', 'Shoppers', 0, 120],
        ['lb', 'loadBalancer', 'Load balancer', X, 120],
        [
          'web',
          'service',
          'Web tier',
          X * 2,
          120,
          {
            instances: 2,
            autoscale: {
              enabled: true,
              minInstances: 2,
              maxInstances: 14,
              targetUtilization: 0.6,
              provisionSec: 90,
              cooldownSec: 300,
            },
          },
        ],
        ['db', 'database', 'Orders DB', X * 3, 120, { instances: 4 }],
      ],
      [
        ['clients', 'lb'],
        ['lb', 'web'],
        ['web', 'db'],
      ],
    ),
    scenario: {
      profile: { type: 'spike', baseRps: 300, spikeRps: 3000, startSec: 3600, durationSec: 1800, rampSec: 120 },
      durationSec: 3 * 3600,
      stepSec: 10,
      noise: 0.05,
      seed: 7,
    },
  },
  {
    id: 'queue-buffer',
    name: 'Queue-buffered writes',
    description: 'A queue absorbs a write burst the database could not handle directly.',
    graph: build(
      [
        ['clients', 'client', 'Writers', 0, 120],
        ['api', 'service', 'Ingest API', X, 120, { instances: 4 }],
        ['queue', 'queue', 'Write queue', X * 2, 120, { instances: 2, queueMaxDepth: 500000 }],
        ['db', 'database', 'Primary DB', X * 3, 120, { instances: 1 }],
      ],
      [
        ['clients', 'api'],
        ['api', 'queue'],
        ['queue', 'db'],
      ],
    ),
    scenario: {
      profile: { type: 'spike', baseRps: 300, spikeRps: 1000, startSec: 1800, durationSec: 1200, rampSec: 60 },
      durationSec: 2 * 3600,
      stepSec: 10,
      noise: 0.03,
      seed: 11,
    },
  },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
