import { beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '../model/presets.ts';
import { useStore } from './useStore.ts';

const store = () => useStore.getState();

beforeEach(() => {
  useStore.setState({
    graph: PRESETS[0]!.graph,
    past: [],
    future: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    notice: null,
  });
});

describe('store editing', () => {
  it('adds nodes with only a name, unique ids, and supports undo/redo', () => {
    const before = store().graph.nodes.length;
    const a = store().addNode('cache', { x: 1, y: 2 });
    const b = store().addNode('cache', { x: 3, y: 4 });
    expect(a).not.toBe(b);
    expect(store().graph.nodes).toHaveLength(before + 2);
    const added = store().graph.nodes.find((n) => n.id === b)!;
    expect(added.name).toBe('Cache 2');
    expect(added.properties).toEqual([]);
    expect(store().selectedNodeIds).toEqual([b]);

    store().undo();
    store().undo();
    expect(store().graph.nodes).toHaveLength(before);
    store().redo();
    expect(store().graph.nodes).toHaveLength(before + 1);
    store().addNode('queue', { x: 0, y: 0 });
    expect(store().future).toHaveLength(0);
  });

  it('edits custom properties and coalesces typing into one undo step', () => {
    store().addProperty('api');
    store().updateProperty('api', 0, { key: 'r' });
    store().updateProperty('api', 0, { key: 're' });
    store().updateProperty('api', 0, { key: 'region' });
    store().updateProperty('api', 0, { value: 'us-west' });
    const props = () => store().graph.nodes.find((n) => n.id === 'api')!.properties;
    expect(props()).toEqual([{ key: 'region', value: 'us-west' }]);
    // add, key edits (coalesced), value edit
    expect(store().past).toHaveLength(3);

    store().removeProperty('api', 0);
    expect(props()).toEqual([]);
    store().undo();
    expect(props()).toHaveLength(1);
  });

  it('removes nodes together with their edges', () => {
    store().removeNodes(['api']);
    expect(store().graph.nodes.some((n) => n.id === 'api')).toBe(false);
    expect(store().graph.edges.every((e) => e.source !== 'api' && e.target !== 'api')).toBe(true);
    store().undo();
    expect(store().graph.edges).toHaveLength(3);
  });

  it('rejects self loops, duplicates, cycles and edges into clients', () => {
    expect(store().connect('api', 'api')).toBe(false);
    expect(store().connect('lb', 'api')).toBe(false);
    expect(store().notice).toBe('Already connected');
    expect(store().connect('db', 'lb')).toBe(false);
    expect(store().notice).toMatch(/cycle/);
    expect(store().connect('api', 'clients')).toBe(false);
    expect(store().connect('lb', 'db')).toBe(true);
    expect(store().graph.edges).toHaveLength(4);
  });

  it('moving nodes records history once per drag', () => {
    store().beginMove();
    store().moveNodes({ api: { x: 5, y: 6 } });
    store().moveNodes({ api: { x: 7, y: 8 } });
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().graph.nodes.find((n) => n.id === 'api')?.position).not.toEqual({ x: 7, y: 8 });
  });

  it('a drag that never moves leaves no history entry', () => {
    store().beginMove();
    expect(store().past).toHaveLength(0);
  });

  it('deleting a node and its edges is a single undo step', () => {
    store().removeNodes(['api']);
    store().removeEdges(['e1', 'e2']);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().graph.nodes.some((n) => n.id === 'api')).toBe(true);
    expect(store().graph.edges).toHaveLength(3);
  });
});
