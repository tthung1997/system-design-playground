export type NodeKind =
  | 'client'
  | 'cdn'
  | 'loadBalancer'
  | 'service'
  | 'cache'
  | 'queue'
  | 'database';

/** A free-form property the user attaches to a component (for example "region: us-west"). */
export interface NodeProperty {
  key: string;
  value: string;
}

export interface Position {
  x: number;
  y: number;
}

export type SizeTier = 'small' | 'medium' | 'large';

/**
 * Bounded simulation settings. Absent fields fall back to the documented defaults, and only the
 * fields a component kind supports (see CONFIG_FIELDS) are accepted.
 */
export interface NodeConfig {
  replicas?: number;
  size?: SizeTier;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  position: Position;
  properties: NodeProperty[];
  config?: NodeConfig;
}

/** Offered traffic for a simulation run. */
export interface Workload {
  /** Requests per second arriving at the clients. */
  rps: number;
  /** Fraction of requests that are reads (0..1); the rest are writes. */
  readRatio: number;
  /** How long the traffic lasts, in seconds (matters for queue backlog). */
  durationSec: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  message: string;
  nodeId?: string;
  edgeId?: string;
}
