import type {
  AutoscaleConfig,
  GraphNode,
  NodeKind,
  NodeParams,
  Position,
  Scenario,
  TrafficProfile,
  TrafficProfileType,
} from './types.ts';

export interface NodeSpec {
  kind: NodeKind;
  label: string;
  icon: string;
  description: string;
  /** Parameters that are meaningful for this kind (drives the properties panel). */
  fields: (keyof NodeParams)[];
  autoscalable: boolean;
  /** Whether the node can receive traffic from other nodes. */
  acceptsInput: boolean;
  defaults: Partial<NodeParams>;
}

export const DEFAULT_AUTOSCALE: AutoscaleConfig = {
  enabled: false,
  minInstances: 1,
  maxInstances: 20,
  targetUtilization: 0.6,
  provisionSec: 120,
  cooldownSec: 300,
};

const BASE_PARAMS: NodeParams = {
  instances: 1,
  capacityPerInstance: 1000,
  latencyMs: 10,
  costPerInstanceHour: 0.1,
  hitRate: 0,
  warmupSec: 0,
  queueMaxDepth: 100000,
  trafficShare: 1,
  autoscale: DEFAULT_AUTOSCALE,
};

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  client: {
    kind: 'client',
    label: 'Clients',
    icon: '👥',
    description: 'Traffic source driven by the scenario traffic profile.',
    fields: ['trafficShare'],
    autoscalable: false,
    acceptsInput: false,
    defaults: { costPerInstanceHour: 0, latencyMs: 0 },
  },
  cdn: {
    kind: 'cdn',
    label: 'CDN',
    icon: '🌐',
    description: 'Edge cache; hits never reach the origin.',
    fields: ['instances', 'capacityPerInstance', 'latencyMs', 'costPerInstanceHour', 'hitRate', 'warmupSec'],
    autoscalable: false,
    acceptsInput: true,
    defaults: {
      capacityPerInstance: 50000,
      latencyMs: 15,
      costPerInstanceHour: 1,
      hitRate: 0.8,
      warmupSec: 600,
    },
  },
  loadBalancer: {
    kind: 'loadBalancer',
    label: 'Load balancer',
    icon: '⚖️',
    description: 'Splits traffic across its outgoing edges.',
    fields: ['instances', 'capacityPerInstance', 'latencyMs', 'costPerInstanceHour'],
    autoscalable: true,
    acceptsInput: true,
    defaults: { capacityPerInstance: 20000, latencyMs: 1, costPerInstanceHour: 0.03 },
  },
  service: {
    kind: 'service',
    label: 'Service',
    icon: '🖥️',
    description: 'Stateless application servers; supports autoscaling.',
    fields: ['instances', 'capacityPerInstance', 'latencyMs', 'costPerInstanceHour'],
    autoscalable: true,
    acceptsInput: true,
    defaults: { capacityPerInstance: 500, latencyMs: 25, costPerInstanceHour: 0.1 },
  },
  cache: {
    kind: 'cache',
    label: 'Cache',
    icon: '⚡',
    description: 'In-memory cache; misses continue downstream.',
    fields: ['instances', 'capacityPerInstance', 'latencyMs', 'costPerInstanceHour', 'hitRate', 'warmupSec'],
    autoscalable: false,
    acceptsInput: true,
    defaults: {
      capacityPerInstance: 20000,
      latencyMs: 2,
      costPerInstanceHour: 0.25,
      hitRate: 0.7,
      warmupSec: 300,
    },
  },
  queue: {
    kind: 'queue',
    label: 'Queue',
    icon: '📬',
    description: 'Buffers bursts; drains at consumer throughput and drops when full.',
    fields: ['instances', 'capacityPerInstance', 'latencyMs', 'costPerInstanceHour', 'queueMaxDepth'],
    autoscalable: true,
    acceptsInput: true,
    defaults: {
      capacityPerInstance: 300,
      latencyMs: 5,
      costPerInstanceHour: 0.08,
      queueMaxDepth: 200000,
    },
  },
  database: {
    kind: 'database',
    label: 'Database',
    icon: '🗄️',
    description: 'Persistent store; scale by adding replicas manually.',
    fields: ['instances', 'capacityPerInstance', 'latencyMs', 'costPerInstanceHour'],
    autoscalable: false,
    acceptsInput: true,
    defaults: { capacityPerInstance: 800, latencyMs: 8, costPerInstanceHour: 0.5 },
  },
};

export const NODE_KINDS = Object.keys(NODE_SPECS) as NodeKind[];

export function defaultParams(kind: NodeKind): NodeParams {
  const params = { ...BASE_PARAMS, ...NODE_SPECS[kind].defaults };
  return { ...params, autoscale: { ...DEFAULT_AUTOSCALE } };
}

export function createNode(
  kind: NodeKind,
  id: string,
  position: Position,
  overrides: Partial<NodeParams> = {},
  name: string = NODE_SPECS[kind].label,
): GraphNode {
  const params = defaultParams(kind);
  return {
    id,
    kind,
    name,
    position,
    params: {
      ...params,
      ...overrides,
      autoscale: { ...params.autoscale, ...overrides.autoscale },
    },
  };
}

export const DEFAULT_SCENARIO: Scenario = {
  profile: { type: 'daily', baseRps: 200, peakRps: 1800, peakHour: 14 },
  durationSec: 24 * 3600,
  stepSec: 60,
  noise: 0.05,
  seed: 42,
};

export function defaultProfile(type: TrafficProfileType): TrafficProfile {
  switch (type) {
    case 'constant':
      return { type, rps: 1000 };
    case 'daily':
      return { type, baseRps: 200, peakRps: 1800, peakHour: 14 };
    case 'spike':
      return { type, baseRps: 300, spikeRps: 3000, startSec: 3600, durationSec: 1800, rampSec: 120 };
    case 'ramp':
      return { type, startRps: 100, endRps: 3000 };
    case 'custom':
      return {
        type,
        points: [
          { t: 0, rps: 200 },
          { t: 3600, rps: 1500 },
          { t: 7200, rps: 400 },
        ],
      };
  }
}
