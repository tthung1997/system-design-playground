import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './useStore.ts';
import { PRESETS } from '../model/presets.ts';

const store = () => useStore.getState();

beforeEach(() => {
  const p = PRESETS[0]!;
  useStore.setState({
    graph: p.graph,
    scenario: p.scenario,
    past: [],
    future: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    result: null,
    running: false,
    runError: null,
    cursor: 0,
    playing: false,
    notice: null,
  });
});

describe('store editing', () => {
  it('adds nodes with unique ids and supports undo/redo', () => {
    const before = store().graph.nodes.length;
    const a = store().addNode('cache', { x: 1, y: 2 });
    const b = store().addNode('cache', { x: 3, y: 4 });
    expect(a).not.toBe(b);
    expect(store().graph.nodes).toHaveLength(before + 2);
    expect(store().graph.nodes.find((n) => n.id === b)?.name).toBe('Cache 2');
    expect(store().selectedNodeIds).toEqual([b]);

    store().undo();
    expect(store().graph.nodes).toHaveLength(before + 1);
    store().undo();
    expect(store().graph.nodes).toHaveLength(before);
    store().redo();
    expect(store().graph.nodes).toHaveLength(before + 1);
    // A new edit clears the redo stack.
    store().addNode('queue', { x: 0, y: 0 });
    expect(store().future).toHaveLength(0);
  });

  it('coalesces rapid edits to the same field into one undo step', () => {
    store().updateParams('api', { instances: 5 });
    store().updateParams('api', { instances: 6 });
    store().updateParams('api', { instances: 7 });
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().graph.nodes.find((n) => n.id === 'api')?.params.instances).toBe(4);
  });

  it('removes nodes together with their edges', () => {
    store().removeNodes(['api']);
    expect(store().graph.nodes.some((n) => n.id === 'api')).toBe(false);
    expect(store().graph.edges.every((e) => e.source !== 'api' && e.target !== 'api')).toBe(true);
    store().undo();
    expect(store().graph.nodes.some((n) => n.id === 'api')).toBe(true);
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

  it('moving nodes records history once per drag and keeps results', () => {
    store().beginMove();
    store().moveNodes({ api: { x: 5, y: 6 } });
    store().moveNodes({ api: { x: 7, y: 8 } });
    expect(store().past).toHaveLength(1);
    expect(store().graph.nodes.find((n) => n.id === 'api')?.position).toEqual({ x: 7, y: 8 });
    store().undo();
    expect(store().graph.nodes.find((n) => n.id === 'api')?.position).not.toEqual({ x: 7, y: 8 });
  });

  it('a drag that never moves leaves no history entry', () => {
    store().beginMove();
    expect(store().past).toHaveLength(0);
  });

  it('deleting a node and its edges is a single undo step', () => {
    store().removeNodes(['api']);
    store().removeEdges(['edge-1', 'e1', 'e2']);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().graph.nodes.some((n) => n.id === 'api')).toBe(true);
    expect(store().graph.edges).toHaveLength(3);
  });

  it('scenario edits and profile switches work and are undoable', () => {
    store().setProfileType('spike');
    expect(store().scenario.profile.type).toBe('spike');
    store().setProfile({ spikeRps: 9999 });
    expect(store().scenario.profile).toMatchObject({ type: 'spike', spikeRps: 9999 });
    store().undo();
    store().undo();
    expect(store().scenario.profile.type).toBe('daily');
  });
});

describe('store simulation', () => {
  it('runs a simulation, then invalidates it on edit', async () => {
    await store().runSimulation();
    expect(store().result).not.toBeNull();
    expect(store().playing).toBe(true);
    store().setCursor(999999);
    expect(store().cursor).toBe(store().result!.steps - 1);
    store().updateParams('api', { instances: 9 });
    expect(store().result).toBeNull();
  });

  it('refuses to run an invalid graph', async () => {
    store().removeNodes(['clients']);
    await store().runSimulation();
    expect(store().result).toBeNull();
    expect(store().runError).toMatch(/Clients/);
  });

  it('ignores results that arrive after an edit', async () => {
    const run = store().runSimulation();
    store().updateParams('api', { instances: 2 });
    await run;
    expect(store().result).toBeNull();
    expect(store().running).toBe(false);
  });
});
