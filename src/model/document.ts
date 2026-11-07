import { CONFIG_FIELDS, createNode, MAX_REPLICAS, NODE_KINDS, SIZE_TIERS, workloadError } from './defaults.ts';
import type { Graph, GraphEdge, GraphNode, NodeConfig, NodeKind, NodeProperty, Workload } from './types.ts';

/** Version 3 adds per-component simulation settings and an optional workload. */
export const DOCUMENT_VERSION = 3;

export interface PlaygroundDocument {
  version: number;
  graph: Graph;
  workload?: Workload;
}

export type ParseResult = { ok: true; doc: PlaygroundDocument } | { ok: false; error: string };

export function serializeDocument(doc: Omit<PlaygroundDocument, 'version'>): string {
  return JSON.stringify({ version: DOCUMENT_VERSION, graph: doc.graph, workload: doc.workload }, null, 2);
}

class ParseError extends Error {}

export function parseWorkload(raw: unknown, path: string): Workload {
  if (!isObject(raw)) throw new ParseError(`${path} must be an object`);
  const w: Workload = {
    rps: num(raw.rps, `${path}.rps`, NaN),
    readRatio: num(raw.readRatio, `${path}.readRatio`, NaN),
    durationSec: num(raw.durationSec, `${path}.durationSec`, NaN),
  };
  const problem = workloadError(w);
  if (problem) throw new ParseError(`${path}: ${problem}`);
  return w;
}

function parseConfig(raw: unknown, kind: NodeKind, path: string): NodeConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw new ParseError(`${path} must be an object`);
  const fields = CONFIG_FIELDS[kind];
  const config: NodeConfig = {};
  if (raw.replicas !== undefined) {
    if (!fields.replicas) throw new ParseError(`${path}.replicas is not supported by ${kind} components`);
    const r = raw.replicas;
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > MAX_REPLICAS) {
      throw new ParseError(`${path}.replicas must be a whole number from 1 to ${MAX_REPLICAS}`);
    }
    config.replicas = r;
  }
  if (raw.size !== undefined) {
    if (!fields.size) throw new ParseError(`${path}.size is not supported by ${kind} components`);
    if (typeof raw.size !== 'string' || !SIZE_TIERS.includes(raw.size as never)) {
      throw new ParseError(`${path}.size must be one of ${SIZE_TIERS.join(', ')}`);
    }
    config.size = raw.size as NodeConfig['size'];
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, path: string, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ParseError(`${path} must be a number`);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new ParseError(`${path} must be a non-empty string`);
  return v;
}

function parseProperties(raw: unknown, path: string): NodeProperty[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ParseError(`${path} must be an array`);
  return raw.map((p, i) => {
    if (!isObject(p)) throw new ParseError(`${path}[${i}] must be an object`);
    const key = p.key === undefined ? '' : p.key;
    const value = p.value === undefined ? '' : p.value;
    if (typeof key !== 'string') throw new ParseError(`${path}[${i}].key must be a string`);
    if (typeof value !== 'string' && typeof value !== 'number') throw new ParseError(`${path}[${i}].value must be a string`);
    return { key, value: String(value) };
  });
}

function parseNode(raw: unknown, i: number, withConfig: boolean): GraphNode {
  const path = `graph.nodes[${i}]`;
  if (!isObject(raw)) throw new ParseError(`${path} must be an object`);
  const kind = raw.kind as NodeKind;
  if (!NODE_KINDS.includes(kind)) throw new ParseError(`${path}.kind "${String(raw.kind)}" is not supported`);
  const pos = isObject(raw.position) ? raw.position : {};
  const id = str(raw.id, `${path}.id`);
  const template = createNode(kind, id, { x: 0, y: 0 });
  const node: GraphNode = {
    id,
    kind,
    name: typeof raw.name === 'string' && raw.name ? raw.name : template.name,
    position: { x: num(pos.x, `${path}.position.x`, 0), y: num(pos.y, `${path}.position.y`, 0) },
    properties: parseProperties(raw.properties, `${path}.properties`),
  };
  const config = withConfig ? parseConfig(raw.config, kind, `${path}.config`) : undefined;
  if (config) node.config = config;
  return node;
}

function parseEdge(raw: unknown, i: number): GraphEdge {
  const path = `graph.edges[${i}]`;
  if (!isObject(raw)) throw new ParseError(`${path} must be an object`);
  return {
    id: str(raw.id, `${path}.id`),
    source: str(raw.source, `${path}.source`),
    target: str(raw.target, `${path}.target`),
  };
}

/**
 * Accepts version 1 and 2 files too. Their numeric parameters and traffic scenarios were never
 * simulated, so they stay ignored; simulation settings are only read from version 3 files.
 */
export function parseDocument(input: unknown): ParseResult {
  try {
    let raw = input;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        throw new ParseError('File is not valid JSON');
      }
    }
    if (!isObject(raw)) throw new ParseError('Document must be an object');
    if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2 && raw.version !== DOCUMENT_VERSION) {
      throw new ParseError(`Unsupported document version ${String(raw.version)}`);
    }
    const withConfig = raw.version === DOCUMENT_VERSION;
    if (!isObject(raw.graph)) throw new ParseError('graph is missing');
    if (!Array.isArray(raw.graph.nodes)) throw new ParseError('graph.nodes must be an array');
    const nodes = raw.graph.nodes.map((n, i) => parseNode(n, i, withConfig));
    const edges = (Array.isArray(raw.graph.edges) ? raw.graph.edges : []).map(parseEdge);
    const workload = withConfig && raw.workload !== undefined ? parseWorkload(raw.workload, 'workload') : undefined;

    const ids = new Set<string>();
    for (const n of nodes) {
      if (ids.has(n.id)) throw new ParseError(`Duplicate node id "${n.id}"`);
      ids.add(n.id);
    }
    const edgeIds = new Set<string>();
    for (const e of edges) {
      if (edgeIds.has(e.id)) throw new ParseError(`Duplicate edge id "${e.id}"`);
      edgeIds.add(e.id);
      if (!ids.has(e.source) || !ids.has(e.target)) throw new ParseError(`Edge "${e.id}" references a missing component`);
    }
    const doc: PlaygroundDocument = { version: DOCUMENT_VERSION, graph: { nodes, edges } };
    if (workload) doc.workload = workload;
    return { ok: true, doc };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message };
    throw e;
  }
}
