import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from './document.ts';
import { flowingEdgeIds, validateGraph } from './graph.ts';
import { createNode } from './defaults.ts';
import { PRESETS } from './presets.ts';
import type { Graph } from './types.ts';

describe('document serialization', () => {
  it('round-trips every preset', () => {
    for (const p of PRESETS) {
      const parsed = parseDocument(serializeDocument({ graph: p.graph }));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.doc.graph).toEqual(p.graph);
    }
  });

  it('keeps custom properties', () => {
    const graph: Graph = {
      nodes: [createNode('service', 'a', { x: 1, y: 2 }, 'API', [{ key: 'region', value: 'us-west' }])],
      edges: [],
    };
    const parsed = parseDocument(serializeDocument({ graph }));
    expect(parsed.ok && parsed.doc.graph.nodes[0]!.properties).toEqual([{ key: 'region', value: 'us-west' }]);
  });

  it('loads version 1 files, ignoring numeric params and the scenario', () => {
    const r = parseDocument({
      version: 1,
      graph: {
        nodes: [
          { id: 'a', kind: 'service', params: { instances: 3 } },
          { id: 'b', kind: 'database' },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', ratio: 2 }],
      },
      scenario: { profile: { type: 'constant', rps: 10 } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.graph.nodes[0]).toMatchObject({ name: 'Service', properties: [] });
      expect(r.doc.graph.edges).toEqual([{ id: 'e1', source: 'a', target: 'b' }]);
    }
  });

  it('reports readable errors', () => {
    expect(parseDocument('not json')).toEqual({ ok: false, error: 'File is not valid JSON' });
    expect(parseDocument({})).toMatchObject({ ok: false, error: 'graph is missing' });
    expect(parseDocument({ graph: { nodes: [{ id: 'a', kind: 'toaster' }] } })).toMatchObject({
      ok: false,
      error: expect.stringContaining('toaster'),
    });
    expect(parseDocument({ version: 99, graph: { nodes: [] } })).toMatchObject({ ok: false });
    expect(
      parseDocument({ graph: { nodes: [{ id: 'a', kind: 'service' }], edges: [{ id: 'e', source: 'a', target: 'zzz' }] } }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('missing') });
    expect(
      parseDocument({ graph: { nodes: [{ id: 'a', kind: 'service', properties: [{ key: 1 }] }] } }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('key') });
  });
});

describe('graph checks', () => {
  const nodes = [
    createNode('client', 'c', { x: 0, y: 0 }, 'Users'),
    createNode('service', 'a', { x: 0, y: 0 }, 'API'),
    createNode('database', 'd', { x: 0, y: 0 }, 'DB'),
    createNode('cache', 'x', { x: 0, y: 0 }, 'Orphan cache'),
  ];

  it('animates only connections fed by a client', () => {
    const graph: Graph = {
      nodes,
      edges: [
        { id: 'e1', source: 'c', target: 'a' },
        { id: 'e2', source: 'a', target: 'd' },
        { id: 'e3', source: 'x', target: 'd' },
      ],
    };
    expect([...flowingEdgeIds(graph)].sort()).toEqual(['e1', 'e2']);
    expect(validateGraph(graph).map((i) => i.nodeId)).toEqual(['x']);
  });

  it('warns when there is no client', () => {
    const issues = validateGraph({ nodes: nodes.slice(1), edges: [] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/Clients/);
  });
});
