import { CONFIG_FIELDS, DEFAULT_REPLICAS, DEFAULT_SIZE } from '../model/defaults.ts';
import type { GraphNode, NodeKind, SizeTier } from '../model/types.ts';

/** Bumped whenever a formula or catalog number changes, so older results are never mixed with new ones. */
export const SIM_VERSION = 1;

/** Queueing delay grows as 1 / (1 - utilization); utilization is capped here so latency stays finite. */
export const MAX_QUEUEING_UTILIZATION = 0.95;

export interface ServiceTier {
  capacityRps: number;
  costUsd: number;
  latencyMs: number;
}
export interface DatabaseTier {
  readRps: number;
  writeRps: number;
  costUsd: number;
  readMs: number;
  writeMs: number;
}
export interface CacheTier {
  hitRatio: number;
  capacityRps: number;
  costUsd: number;
  latencyMs: number;
}
export interface QueueTier {
  enqueueRps: number;
  maxBacklog: number;
  costUsd: number;
  ackMs: number;
}

/** Per-replica capacity, latency and illustrative monthly cost (USD). */
export const SERVICE_TIERS: Record<SizeTier, ServiceTier> = {
  small: { capacityRps: 400, costUsd: 60, latencyMs: 25 },
  medium: { capacityRps: 1000, costUsd: 130, latencyMs: 20 },
  large: { capacityRps: 2500, costUsd: 300, latencyMs: 15 },
};

/** Every database node serves reads; only the primary accepts writes (replicas take over on failure). */
export const DATABASE_TIERS: Record<SizeTier, DatabaseTier> = {
  small: { readRps: 800, writeRps: 200, costUsd: 120, readMs: 10, writeMs: 20 },
  medium: { readRps: 2000, writeRps: 500, costUsd: 260, readMs: 8, writeMs: 16 },
  large: { readRps: 5000, writeRps: 1200, costUsd: 600, readMs: 6, writeMs: 12 },
};

/** The hit ratio is a property of the tier (memory size), not a number the designer can type in. */
export const CACHE_TIERS: Record<SizeTier, CacheTier> = {
  small: { hitRatio: 0.6, capacityRps: 20000, costUsd: 40, latencyMs: 1 },
  medium: { hitRatio: 0.8, capacityRps: 40000, costUsd: 90, latencyMs: 1 },
  large: { hitRatio: 0.9, capacityRps: 80000, costUsd: 200, latencyMs: 1 },
};

export const QUEUE_TIERS: Record<SizeTier, QueueTier> = {
  small: { enqueueRps: 5000, maxBacklog: 200_000, costUsd: 30, ackMs: 5 },
  medium: { enqueueRps: 10000, maxBacklog: 1_000_000, costUsd: 70, ackMs: 5 },
  large: { enqueueRps: 20000, maxBacklog: 5_000_000, costUsd: 140, ackMs: 5 },
};

export const LOAD_BALANCER = { capacityRps: 20000, costUsd: 25, latencyMs: 2 };

/** Edge cache for reads; fixed size, effectively unlimited throughput. */
export const CDN = { hitRatio: 0.6, capacityRps: 1_000_000, costUsd: 150, latencyMs: 15 };

/** Probability that a single replica is up. Managed services (CDN, queue) are assumed more reliable. */
export const REPLICA_AVAILABILITY: Record<NodeKind, number> = {
  client: 1,
  cdn: 0.9999,
  loadBalancer: 0.999,
  service: 0.995,
  cache: 0.995,
  queue: 0.9999,
  database: 0.995,
};

export interface ResolvedConfig {
  replicas: number;
  size: SizeTier;
}

export function resolveConfig(node: GraphNode): ResolvedConfig {
  const fields = CONFIG_FIELDS[node.kind];
  return {
    replicas: fields.replicas ? (node.config?.replicas ?? DEFAULT_REPLICAS) : 1,
    size: fields.size ? (node.config?.size ?? DEFAULT_SIZE[node.kind]) : DEFAULT_SIZE[node.kind],
  };
}

/** Monthly cost of one component, counted whether or not any traffic reaches it. */
export function monthlyCost(node: GraphNode): number {
  const { replicas, size } = resolveConfig(node);
  switch (node.kind) {
    case 'client':
      return 0;
    case 'cdn':
      return CDN.costUsd;
    case 'loadBalancer':
      return LOAD_BALANCER.costUsd * replicas;
    case 'service':
      return SERVICE_TIERS[size].costUsd * replicas;
    case 'cache':
      return CACHE_TIERS[size].costUsd * replicas;
    case 'queue':
      return QUEUE_TIERS[size].costUsd;
    case 'database':
      return DATABASE_TIERS[size].costUsd * replicas;
  }
}

/** One-line description of what a component's current settings provide, shown in the UI. */
export function describeConfig(node: GraphNode): string {
  const { replicas, size } = resolveConfig(node);
  switch (node.kind) {
    case 'client':
      return 'Traffic source';
    case 'cdn':
      return `${CDN.hitRatio * 100}% of reads served at the edge · $${CDN.costUsd}/mo`;
    case 'loadBalancer':
      return `${(LOAD_BALANCER.capacityRps * replicas).toLocaleString()} rps · $${monthlyCost(node)}/mo`;
    case 'service': {
      const t = SERVICE_TIERS[size];
      return `${(t.capacityRps * replicas).toLocaleString()} rps · ${t.latencyMs} ms · $${monthlyCost(node)}/mo`;
    }
    case 'cache': {
      const t = CACHE_TIERS[size];
      return `${t.hitRatio * 100}% read hits · ${(t.capacityRps * replicas).toLocaleString()} rps · $${monthlyCost(node)}/mo`;
    }
    case 'queue': {
      const t = QUEUE_TIERS[size];
      return `${t.enqueueRps.toLocaleString()} enqueues/s · ${t.maxBacklog.toLocaleString()} backlog · $${t.costUsd}/mo`;
    }
    case 'database': {
      const t = DATABASE_TIERS[size];
      return `${(t.readRps * replicas).toLocaleString()} reads/s · ${t.writeRps.toLocaleString()} writes/s · $${monthlyCost(node)}/mo`;
    }
  }
}
