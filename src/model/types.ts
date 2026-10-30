export type NodeKind =
  | 'client'
  | 'cdn'
  | 'loadBalancer'
  | 'service'
  | 'cache'
  | 'queue'
  | 'database';

export interface AutoscaleConfig {
  enabled: boolean;
  minInstances: number;
  maxInstances: number;
  /** Target utilization (0-1] the autoscaler tries to maintain. */
  targetUtilization: number;
  /** Delay between launching an instance and it serving traffic (billed meanwhile). */
  provisionSec: number;
  /** Minimum time after any scaling action before instances are removed. */
  cooldownSec: number;
}

export interface NodeParams {
  instances: number;
  /** Requests/second one instance can handle (queue: consumer throughput). */
  capacityPerInstance: number;
  /** Base latency added by this node at low load. */
  latencyMs: number;
  costPerInstanceHour: number;
  /** cache/cdn: fraction of served requests answered locally. */
  hitRate: number;
  /** cache/cdn: seconds for the hit rate to ramp from 0 to hitRate after start. */
  warmupSec: number;
  /** queue: maximum backlog before new messages are dropped. */
  queueMaxDepth: number;
  /** client: relative share of total traffic. */
  trafficShare: number;
  autoscale: AutoscaleConfig;
}

export interface Position {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  position: Position;
  params: NodeParams;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Relative share of the source's forwarded traffic routed along this edge. */
  ratio: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type TrafficProfile =
  | { type: 'constant'; rps: number }
  | { type: 'daily'; baseRps: number; peakRps: number; peakHour: number }
  | {
      type: 'spike';
      baseRps: number;
      spikeRps: number;
      startSec: number;
      durationSec: number;
      rampSec: number;
    }
  | { type: 'ramp'; startRps: number; endRps: number }
  | { type: 'custom'; points: { t: number; rps: number }[] };

export type TrafficProfileType = TrafficProfile['type'];

export interface Scenario {
  profile: TrafficProfile;
  durationSec: number;
  stepSec: number;
  /** Random multiplicative noise amplitude on the offered rate, 0-1. */
  noise: number;
  seed: number;
}

export interface NodeMetrics {
  arrival: number;
  capacity: number;
  served: number;
  dropped: number;
  forwarded: number;
  completed: number;
  utilization: number;
  instances: number;
  pendingInstances: number;
  hitRate: number;
  backlog: number;
  /** Local latency including load-induced queueing delay. */
  latencyMs: number;
  /** Expected latency of a request entering this node, including downstream. */
  pathLatencyMs: number;
  costPerHour: number;
}

export interface Analysis {
  nodes: Record<string, NodeMetrics>;
  /** Flow carried by each edge (requests/second). */
  edges: Record<string, number>;
  offered: number;
  completed: number;
  dropped: number;
  successRate: number;
  avgLatencyMs: number;
  costPerHour: number;
  /** Highest offered load the architecture sustains without dropping. */
  maxThroughput: number;
  /** maxThroughput / offered (Infinity when nothing constrains it). */
  headroom: number;
  bottleneckId: string | null;
  saturatedIds: string[];
}

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  message: string;
  nodeId?: string;
  edgeId?: string;
}
