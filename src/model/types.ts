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

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  position: Position;
  properties: NodeProperty[];
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
