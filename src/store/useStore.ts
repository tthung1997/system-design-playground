import { create } from 'zustand';
import { runSimulationAsync } from '../engine/client.ts';
import { hasErrors, validateGraph } from '../engine/graph.ts';
import { validateScenario } from '../engine/simulate.ts';
import type { SimulationResult } from '../engine/simulate.ts';
import { createNode, defaultProfile, NODE_SPECS } from '../model/defaults.ts';
import type { PlaygroundDocument } from '../model/document.ts';
import { getPreset, PRESETS } from '../model/presets.ts';
import type {
  Graph,
  GraphNode,
  NodeKind,
  NodeParams,
  Position,
  Scenario,
  TrafficProfileType,
} from '../model/types.ts';
import { loadSavedDocument } from './storage.ts';

interface Snapshot {
  graph: Graph;
  scenario: Scenario;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;
/** Deleting a selection emits node and edge removals back to back; they form one undo step. */
const REMOVE_WINDOW_MS = 50;

export const PLAYBACK_SECONDS = 30;

export interface PlaygroundState extends Snapshot {
  past: Snapshot[];
  future: Snapshot[];
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  /** Incremented when a whole document is loaded, so the canvas can refit its viewport. */
  docVersion: number;

  result: SimulationResult | null;
  running: boolean;
  runError: string | null;
  cursor: number;
  playing: boolean;
  speed: number;
  notice: string | null;

  addNode: (kind: NodeKind, position: Position) => string;
  updateNode: (id: string, patch: { name?: string }) => void;
  updateParams: (id: string, patch: Partial<Omit<NodeParams, 'autoscale'>>) => void;
  updateAutoscale: (id: string, patch: Partial<NodeParams['autoscale']>) => void;
  moveNodes: (positions: Record<string, Position>) => void;
  beginMove: () => void;
  removeNodes: (ids: string[]) => void;
  removeEdges: (ids: string[]) => void;
  connect: (source: string, target: string) => boolean;
  updateEdge: (id: string, ratio: number) => void;
  setScenario: (patch: Partial<Scenario>) => void;
  setProfileType: (type: TrafficProfileType) => void;
  setProfile: (patch: Record<string, unknown>) => void;

  setSelection: (nodeIds: string[], edgeIds: string[]) => void;
  undo: () => void;
  redo: () => void;
  loadDocument: (doc: Pick<PlaygroundDocument, 'graph' | 'scenario'>) => void;
  loadPreset: (id: string) => void;

  runSimulation: () => Promise<void>;
  clearResult: () => void;
  setCursor: (cursor: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setNotice: (notice: string | null) => void;
}

function uniqueId(prefix: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) return id;
  }
}

function reaches(graph: Graph, from: string, to: string): boolean {
  const adj: Record<string, string[]> = {};
  for (const e of graph.edges) (adj[e.source] ??= []).push(e.target);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(adj[id] ?? []));
  }
  return false;
}

function initialDocument(): Snapshot {
  const saved = loadSavedDocument();
  if (saved) return { graph: saved.graph, scenario: saved.scenario };
  const preset = PRESETS[0]!;
  return { graph: preset.graph, scenario: preset.scenario };
}

const NO_RESULT = { result: null, running: false, runError: null, cursor: 0, playing: false } as const;

export const useStore = create<PlaygroundState>()((set, get) => {
  let lastKey: string | null = null;
  let lastTime = 0;
  let runToken = 0;
  /** Snapshot taken when a drag starts; only committed to history once a node actually moves. */
  let pendingMove: Snapshot | null = null;

  /** Applies an edit, records undo history (coalescing rapid edits with the same key) and invalidates results. */
  const edit = (mutate: (s: Snapshot) => Snapshot | null, key?: string, windowMs = COALESCE_MS) => {
    const { graph, scenario, past } = get();
    const next = mutate({ graph, scenario });
    if (!next) return;
    pendingMove = null;
    const now = Date.now();
    const coalesce = key !== undefined && key === lastKey && now - lastTime < windowMs;
    lastKey = key ?? null;
    lastTime = now;
    const nodeIds = new Set(next.graph.nodes.map((n) => n.id));
    const edgeIds = new Set(next.graph.edges.map((e) => e.id));
    runToken++;
    set((s) => ({
      ...next,
      past: coalesce ? past : [...past, { graph, scenario }].slice(-HISTORY_LIMIT),
      future: [],
      selectedNodeIds: s.selectedNodeIds.filter((id) => nodeIds.has(id)),
      selectedEdgeIds: s.selectedEdgeIds.filter((id) => edgeIds.has(id)),
      ...NO_RESULT,
    }));
  };

  const mapNode = (id: string, fn: (n: GraphNode) => GraphNode) => (s: Snapshot) => ({
    ...s,
    graph: { ...s.graph, nodes: s.graph.nodes.map((n) => (n.id === id ? fn(n) : n)) },
  });

  const restore = (snap: Snapshot, past: Snapshot[], future: Snapshot[]) => {
    const nodeIds = new Set(snap.graph.nodes.map((n) => n.id));
    const edgeIds = new Set(snap.graph.edges.map((e) => e.id));
    lastKey = null;
    pendingMove = null;
    runToken++;
    set((s) => ({
      ...snap,
      past,
      future,
      selectedNodeIds: s.selectedNodeIds.filter((id) => nodeIds.has(id)),
      selectedEdgeIds: s.selectedEdgeIds.filter((id) => edgeIds.has(id)),
      ...NO_RESULT,
    }));
  };

  return {
    ...initialDocument(),
    past: [],
    future: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    docVersion: 0,
    ...NO_RESULT,
    speed: 1,
    notice: null,

    addNode: (kind, position) => {
      const id = uniqueId(kind, new Set(get().graph.nodes.map((n) => n.id)));
      const sameKind = get().graph.nodes.filter((n) => n.kind === kind).length;
      const label = NODE_SPECS[kind].label;
      const name = sameKind === 0 ? label : `${label} ${sameKind + 1}`;
      edit((s) => ({ ...s, graph: { ...s.graph, nodes: [...s.graph.nodes, createNode(kind, id, position, {}, name)] } }));
      set({ selectedNodeIds: [id], selectedEdgeIds: [] });
      return id;
    },

    updateNode: (id, patch) =>
      edit(mapNode(id, (n) => ({ ...n, ...patch })), `name:${id}`),

    updateParams: (id, patch) =>
      edit(
        mapNode(id, (n) => ({ ...n, params: { ...n.params, ...patch } })),
        `params:${id}:${Object.keys(patch).join(',')}`,
      ),

    updateAutoscale: (id, patch) =>
      edit(
        mapNode(id, (n) => ({ ...n, params: { ...n.params, autoscale: { ...n.params.autoscale, ...patch } } })),
        `autoscale:${id}:${Object.keys(patch).join(',')}`,
      ),

    moveNodes: (positions) => {
      if (pendingMove) {
        const snap = pendingMove;
        pendingMove = null;
        lastKey = null;
        set((s) => ({ past: [...s.past, snap].slice(-HISTORY_LIMIT), future: [] }));
      }
      set((s) => ({
        graph: {
          ...s.graph,
          nodes: s.graph.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id]! } : n)),
        },
      }));
    },

    beginMove: () => {
      const { graph, scenario } = get();
      pendingMove = { graph, scenario };
    },

    removeNodes: (ids) => {
      const existing = new Set(get().graph.nodes.map((n) => n.id));
      const drop = new Set(ids.filter((id) => existing.has(id)));
      if (drop.size === 0) return;
      edit((s) => ({
        ...s,
        graph: {
          nodes: s.graph.nodes.filter((n) => !drop.has(n.id)),
          edges: s.graph.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
        },
      }), 'remove', REMOVE_WINDOW_MS);
    },

    removeEdges: (ids) => {
      const existing = new Set(get().graph.edges.map((e) => e.id));
      const drop = new Set(ids.filter((id) => existing.has(id)));
      if (drop.size === 0) return;
      edit(
        (s) => ({ ...s, graph: { ...s.graph, edges: s.graph.edges.filter((e) => !drop.has(e.id)) } }),
        'remove',
        REMOVE_WINDOW_MS,
      );
    },

    connect: (source, target) => {
      const { graph } = get();
      const src = graph.nodes.find((n) => n.id === source);
      const dst = graph.nodes.find((n) => n.id === target);
      let problem: string | null = null;
      if (!src || !dst) problem = 'Unknown node';
      else if (source === target) problem = 'A node cannot connect to itself';
      else if (!NODE_SPECS[dst.kind].acceptsInput) problem = `${dst.name} cannot receive traffic`;
      else if (graph.edges.some((e) => e.source === source && e.target === target)) problem = 'Already connected';
      else if (reaches(graph, target, source)) problem = 'That connection would create a cycle';
      if (problem) {
        set({ notice: problem });
        return false;
      }
      const id = uniqueId('edge', new Set(graph.edges.map((e) => e.id)));
      edit((s) => ({ ...s, graph: { ...s.graph, edges: [...s.graph.edges, { id, source, target, ratio: 1 }] } }));
      return true;
    },

    updateEdge: (id, ratio) =>
      edit(
        (s) => ({ ...s, graph: { ...s.graph, edges: s.graph.edges.map((e) => (e.id === id ? { ...e, ratio } : e)) } }),
        `edge:${id}`,
      ),

    setScenario: (patch) => edit((s) => ({ ...s, scenario: { ...s.scenario, ...patch } }), `scenario:${Object.keys(patch).join(',')}`),

    setProfileType: (type) => {
      if (get().scenario.profile.type === type) return;
      edit((s) => ({ ...s, scenario: { ...s.scenario, profile: defaultProfile(type) } }));
    },

    setProfile: (patch) =>
      edit(
        (s) => ({ ...s, scenario: { ...s.scenario, profile: { ...s.scenario.profile, ...patch } as Scenario['profile'] } }),
        `profile:${Object.keys(patch).join(',')}`,
      ),

    setSelection: (nodeIds, edgeIds) => {
      const s = get();
      const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
      if (same(s.selectedNodeIds, nodeIds) && same(s.selectedEdgeIds, edgeIds)) return;
      set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
    },

    undo: () => {
      const { past, future, graph, scenario } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      restore(prev, past.slice(0, -1), [{ graph, scenario }, ...future]);
    },

    redo: () => {
      const { past, future, graph, scenario } = get();
      const next = future[0];
      if (!next) return;
      restore(next, [...past, { graph, scenario }], future.slice(1));
    },

    loadDocument: (doc) => {
      const { graph, scenario, past } = get();
      lastKey = null;
      pendingMove = null;
      runToken++;
      set({
        graph: doc.graph,
        scenario: doc.scenario,
        past: [...past, { graph, scenario }].slice(-HISTORY_LIMIT),
        future: [],
        selectedNodeIds: [],
        selectedEdgeIds: [],
        docVersion: get().docVersion + 1,
        ...NO_RESULT,
      });
    },

    loadPreset: (id) => {
      const preset = getPreset(id);
      if (preset) get().loadDocument({ graph: preset.graph, scenario: preset.scenario });
    },

    runSimulation: async () => {
      const { graph, scenario } = get();
      const issues = [...validateGraph(graph), ...validateScenario(scenario)];
      if (hasErrors(issues)) {
        set({ runError: issues.find((i) => i.severity === 'error')!.message });
        return;
      }
      const token = ++runToken;
      set({ running: true, runError: null, playing: false });
      try {
        const result = await runSimulationAsync(graph, scenario);
        if (token !== runToken) return;
        set({ result, running: false, cursor: 0, playing: true });
      } catch (e) {
        if (token !== runToken) return;
        set({ running: false, runError: e instanceof Error ? e.message : String(e) });
      }
    },

    clearResult: () => {
      runToken++;
      set({ ...NO_RESULT });
    },

    setCursor: (cursor) => {
      const r = get().result;
      if (!r) return;
      set({ cursor: Math.min(Math.max(Math.round(cursor), 0), r.steps - 1) });
    },
    setPlaying: (playing) => {
      const { result, cursor } = get();
      if (!result) return;
      set({ playing, cursor: playing && cursor >= result.steps - 1 ? 0 : cursor });
    },
    setSpeed: (speed) => set({ speed }),
    setNotice: (notice) => set({ notice }),
  };
});
