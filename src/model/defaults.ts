import type { GraphNode, NodeKind, NodeProperty, Position, SizeTier, Workload } from './types.ts';

export interface NodeSpec {
  kind: NodeKind;
  label: string;
  description: string;
  /** Whether the component can receive traffic from other components. */
  acceptsInput: boolean;
}

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  client: {
    kind: 'client',
    label: 'Clients',
    description: 'Where traffic originates.',
    acceptsInput: false,
  },
  cdn: {
    kind: 'cdn',
    label: 'CDN',
    description: 'Edge cache in front of your origin.',
    acceptsInput: true,
  },
  loadBalancer: {
    kind: 'loadBalancer',
    label: 'Load balancer',
    description: 'Spreads traffic across its outgoing connections.',
    acceptsInput: true,
  },
  service: {
    kind: 'service',
    label: 'Service',
    description: 'Application servers.',
    acceptsInput: true,
  },
  cache: {
    kind: 'cache',
    label: 'Cache',
    description: 'In-memory cache.',
    acceptsInput: true,
  },
  queue: {
    kind: 'queue',
    label: 'Queue',
    description: 'Buffers messages between components.',
    acceptsInput: true,
  },
  database: {
    kind: 'database',
    label: 'Database',
    description: 'Persistent store.',
    acceptsInput: true,
  },
};

export const NODE_KINDS = Object.keys(NODE_SPECS) as NodeKind[];

export const MAX_REPLICAS = 20;
export const SIZE_TIERS: SizeTier[] = ['small', 'medium', 'large'];

/** Which simulation settings each component kind exposes. */
export const CONFIG_FIELDS: Record<NodeKind, { replicas: boolean; size: boolean }> = {
  client: { replicas: false, size: false },
  cdn: { replicas: false, size: false },
  loadBalancer: { replicas: true, size: false },
  service: { replicas: true, size: true },
  cache: { replicas: true, size: true },
  queue: { replicas: false, size: true },
  database: { replicas: true, size: true },
};

export const DEFAULT_REPLICAS = 1;
export const DEFAULT_SIZE: Record<NodeKind, SizeTier> = {
  client: 'medium',
  cdn: 'medium',
  loadBalancer: 'medium',
  service: 'medium',
  cache: 'medium',
  queue: 'small',
  database: 'medium',
};

export const WORKLOAD_LIMITS = { maxRps: 1_000_000, minDurationSec: 1, maxDurationSec: 3600 };

export const DEFAULT_WORKLOAD: Workload = { rps: 1000, readRatio: 0.9, durationSec: 60 };

export function workloadError(w: Workload): string | null {
  if (!Number.isFinite(w.rps) || w.rps < 0 || w.rps > WORKLOAD_LIMITS.maxRps) {
    return `Requests per second must be between 0 and ${WORKLOAD_LIMITS.maxRps}`;
  }
  if (!Number.isFinite(w.readRatio) || w.readRatio < 0 || w.readRatio > 1) return 'Read ratio must be between 0 and 1';
  if (
    !Number.isFinite(w.durationSec) ||
    w.durationSec < WORKLOAD_LIMITS.minDurationSec ||
    w.durationSec > WORKLOAD_LIMITS.maxDurationSec
  ) {
    return `Duration must be between ${WORKLOAD_LIMITS.minDurationSec} and ${WORKLOAD_LIMITS.maxDurationSec} seconds`;
  }
  return null;
}

/** Components start with just a name; the user decides which properties to add. */
export function createNode(
  kind: NodeKind,
  id: string,
  position: Position,
  name: string = NODE_SPECS[kind].label,
  properties: NodeProperty[] = [],
): GraphNode {
  return { id, kind, name, position, properties };
}
