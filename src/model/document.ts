import { createNode, NODE_KINDS } from './defaults.ts';
import type { Graph, GraphEdge, GraphNode, NodeKind, NodeProperty } from './types.ts';

export const DOCUMENT_VERSION = 2;

export interface PlaygroundDocument {
  version: number;
  graph: Graph;
}

export type ParseResult = { ok: true; doc: PlaygroundDocument } | { ok: false; error: string };

export function serializeDocument(doc: Omit<PlaygroundDocument, 'version'>): string {
  return JSON.stringify({ version: DOCUMENT_VERSION, graph: doc.graph }, null, 2);
}

class ParseError extends Error {}

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

function parseNode(raw: unknown, i: number): GraphNode {
  const path = `graph.nodes[${i}]`;
  if (!isObject(raw)) throw new ParseError(`${path} must be an object`);
  const kind = raw.kind as NodeKind;
  if (!NODE_KINDS.includes(kind)) throw new ParseError(`${path}.kind "${String(raw.kind)}" is not supported`);
  const pos = isObject(raw.position) ? raw.position : {};
  const id = str(raw.id, `${path}.id`);
  const template = createNode(kind, id, { x: 0, y: 0 });
  return {
    id,
    kind,
    name: typeof raw.name === 'string' && raw.name ? raw.name : template.name,
    position: { x: num(pos.x, `${path}.position.x`, 0), y: num(pos.y, `${path}.position.y`, 0) },
    properties: parseProperties(raw.properties, `${path}.properties`),
  };
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

/** Accepts version 1 files too; their numeric parameters and traffic scenario are ignored. */
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
    if (raw.version !== undefined && raw.version !== 1 && raw.version !== DOCUMENT_VERSION) {
      throw new ParseError(`Unsupported document version ${String(raw.version)}`);
    }
    if (!isObject(raw.graph)) throw new ParseError('graph is missing');
    if (!Array.isArray(raw.graph.nodes)) throw new ParseError('graph.nodes must be an array');
    const nodes = raw.graph.nodes.map(parseNode);
    const edges = (Array.isArray(raw.graph.edges) ? raw.graph.edges : []).map(parseEdge);

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
    return { ok: true, doc: { version: DOCUMENT_VERSION, graph: { nodes, edges } } };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message };
    throw e;
  }
}
