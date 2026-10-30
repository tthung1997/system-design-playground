import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from './document.ts';
import { PRESETS } from './presets.ts';

describe('document serialization', () => {
  it('round-trips every preset', () => {
    for (const p of PRESETS) {
      const text = serializeDocument({ graph: p.graph, scenario: p.scenario });
      const parsed = parseDocument(text);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.doc.graph).toEqual(p.graph);
        expect(parsed.doc.scenario).toEqual(p.scenario);
      }
    }
  });

  it('fills defaults for missing params and scenario', () => {
    const r = parseDocument({
      graph: { nodes: [{ id: 'a', kind: 'service', params: { instances: 3 } }], edges: [] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const node = r.doc.graph.nodes[0]!;
      expect(node.params.instances).toBe(3);
      expect(node.params.capacityPerInstance).toBeGreaterThan(0);
      expect(node.name).toBe('Service');
      expect(r.doc.scenario.stepSec).toBeGreaterThan(0);
    }
  });

  it('reports readable errors', () => {
    expect(parseDocument('not json')).toEqual({ ok: false, error: 'File is not valid JSON' });
    expect(parseDocument({})).toMatchObject({ ok: false, error: 'graph is missing' });
    expect(parseDocument({ graph: { nodes: [{ id: 'a', kind: 'toaster' }] } })).toMatchObject({
      ok: false,
      error: expect.stringContaining('toaster'),
    });
    expect(
      parseDocument({ graph: { nodes: [{ id: 'a', kind: 'service', params: { instances: 'x' } }] } }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('instances') });
    expect(parseDocument({ version: 99, graph: { nodes: [] } })).toMatchObject({ ok: false });
    expect(
      parseDocument({ graph: { nodes: [] }, scenario: { profile: { type: 'custom', points: [] } } }),
    ).toMatchObject({ ok: false });
  });
});
