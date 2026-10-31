import type { GraphNode, NodeKind, NodeProperty, Position } from './types.ts';

export interface NodeSpec {
  kind: NodeKind;
  label: string;
  icon: string;
  description: string;
  /** Whether the component can receive traffic from other components. */
  acceptsInput: boolean;
}

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  client: {
    kind: 'client',
    label: 'Clients',
    icon: '👥',
    description: 'Where traffic originates.',
    acceptsInput: false,
  },
  cdn: {
    kind: 'cdn',
    label: 'CDN',
    icon: '🌐',
    description: 'Edge cache in front of your origin.',
    acceptsInput: true,
  },
  loadBalancer: {
    kind: 'loadBalancer',
    label: 'Load balancer',
    icon: '⚖️',
    description: 'Spreads traffic across its outgoing connections.',
    acceptsInput: true,
  },
  service: {
    kind: 'service',
    label: 'Service',
    icon: '🖥️',
    description: 'Application servers.',
    acceptsInput: true,
  },
  cache: {
    kind: 'cache',
    label: 'Cache',
    icon: '⚡',
    description: 'In-memory cache.',
    acceptsInput: true,
  },
  queue: {
    kind: 'queue',
    label: 'Queue',
    icon: '📬',
    description: 'Buffers messages between components.',
    acceptsInput: true,
  },
  database: {
    kind: 'database',
    label: 'Database',
    icon: '🗄️',
    description: 'Persistent store.',
    acceptsInput: true,
  },
};

export const NODE_KINDS = Object.keys(NODE_SPECS) as NodeKind[];

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
