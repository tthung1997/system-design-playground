import { createNode, DEFAULT_SCENARIO, defaultParams, defaultProfile, NODE_KINDS } from './defaults.ts';
import type {
  Graph,
  GraphEdge,
  GraphNode,
  NodeKind,
  NodeParams,
  Scenario,
  TrafficProfile,
  TrafficProfileType,
} from './types.ts';

export const DOCUMENT_VERSION = 1;

export interface PlaygroundDocument {
  version: number;
  graph: Graph;
  scenario: Scenario;
}

export type ParseResult = { ok: true; doc: PlaygroundDocument } | { ok: false; error: string };

export function serializeDocument(doc: Omit<PlaygroundDocument, 'version'>): string {
  return JSON.stringify({ version: DOCUMENT_VERSION, graph: doc.graph, scenario: doc.scenario }, null, 2);
}

class ParseError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, path: string, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ParseError(`${path} must be a number`);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new ParseError(`${path} must be a non-empty string`);
  return v;
}

function parseParams(raw: unknown, kind: NodeKind, path: string): NodeParams {
  const base = defaultParams(kind);
  if (raw === undefined) return base;
  if (!isObject(raw)) throw new ParseError(`${path} must be an object`);
  const params: NodeParams = { ...base };
  for (const key of Object.keys(base) as (keyof NodeParams)[]) {
    if (key === 'autoscale' || raw[key] === undefined) continue;
    (params[key] as number) = num(raw[key], `${path}.${key}`);
  }
  if (raw.autoscale !== undefined) {
    if (!isObject(raw.autoscale)) throw new ParseError(`${path}.autoscale must be an object`);
    const a = raw.autoscale;
    const b = base.autoscale;
    if (a.enabled !== undefined && typeof a.enabled !== 'boolean') {
      throw new ParseError(`${path}.autoscale.enabled must be a boolean`);
    }
    params.autoscale = {
      enabled: (a.enabled as boolean | undefined) ?? b.enabled,
      minInstances: num(a.minInstances, `${path}.autoscale.minInstances`, b.minInstances),
      maxInstances: num(a.maxInstances, `${path}.autoscale.maxInstances`, b.maxInstances),
      targetUtilization: num(a.targetUtilization, `${path}.autoscale.targetUtilization`, b.targetUtilization),
      provisionSec: num(a.provisionSec, `${path}.autoscale.provisionSec`, b.provisionSec),
      cooldownSec: num(a.cooldownSec, `${path}.autoscale.cooldownSec`, b.cooldownSec),
    };
  }
  return params;
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
    params: parseParams(raw.params, kind, `${path}.params`),
  };
}

function parseEdge(raw: unknown, i: number): GraphEdge {
  const path = `graph.edges[${i}]`;
  if (!isObject(raw)) throw new ParseError(`${path} must be an object`);
  return {
    id: str(raw.id, `${path}.id`),
    source: str(raw.source, `${path}.source`),
    target: str(raw.target, `${path}.target`),
    ratio: num(raw.ratio, `${path}.ratio`, 1),
  };
}

const PROFILE_TYPES: TrafficProfileType[] = ['constant', 'daily', 'spike', 'ramp', 'custom'];

function parseProfile(raw: unknown): TrafficProfile {
  const path = 'scenario.profile';
  if (!isObject(raw)) throw new ParseError(`${path} must be an object`);
  const type = raw.type as TrafficProfileType;
  if (!PROFILE_TYPES.includes(type)) throw new ParseError(`${path}.type "${String(raw.type)}" is not supported`);
  const d = defaultProfile(type) as Record<string, unknown>;
  if (type === 'custom') {
    if (!Array.isArray(raw.points) || raw.points.length === 0) {
      throw new ParseError(`${path}.points must be a non-empty array`);
    }
    const points = raw.points.map((p, i) => {
      if (!isObject(p)) throw new ParseError(`${path}.points[${i}] must be an object`);
      return { t: num(p.t, `${path}.points[${i}].t`), rps: num(p.rps, `${path}.points[${i}].rps`) };
    });
    return { type, points };
  }
  const out: Record<string, unknown> = { type };
  for (const key of Object.keys(d)) {
    if (key !== 'type') out[key] = num(raw[key], `${path}.${key}`, d[key] as number);
  }
  return out as unknown as TrafficProfile;
}

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
    if (raw.version !== undefined && raw.version !== DOCUMENT_VERSION) {
      throw new ParseError(`Unsupported document version ${String(raw.version)}`);
    }
    if (!isObject(raw.graph)) throw new ParseError('graph is missing');
    if (!Array.isArray(raw.graph.nodes)) throw new ParseError('graph.nodes must be an array');
    const nodes = raw.graph.nodes.map(parseNode);
    const edges = (Array.isArray(raw.graph.edges) ? raw.graph.edges : []).map(parseEdge);

    let scenario: Scenario = { ...DEFAULT_SCENARIO };
    if (raw.scenario !== undefined) {
      if (!isObject(raw.scenario)) throw new ParseError('scenario must be an object');
      const s = raw.scenario;
      scenario = {
        profile: s.profile === undefined ? DEFAULT_SCENARIO.profile : parseProfile(s.profile),
        durationSec: num(s.durationSec, 'scenario.durationSec', DEFAULT_SCENARIO.durationSec),
        stepSec: num(s.stepSec, 'scenario.stepSec', DEFAULT_SCENARIO.stepSec),
        noise: num(s.noise, 'scenario.noise', DEFAULT_SCENARIO.noise),
        seed: num(s.seed, 'scenario.seed', DEFAULT_SCENARIO.seed),
      };
    }
    return { ok: true, doc: { version: DOCUMENT_VERSION, graph: { nodes, edges }, scenario } };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message };
    throw e;
  }
}
