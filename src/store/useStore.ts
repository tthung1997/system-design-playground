import { create } from 'zustand';
import { createNode, NODE_SPECS } from '../model/defaults.ts';
import type { PlaygroundDocument } from '../model/document.ts';
import { getPreset, PRESETS } from '../model/presets.ts';
import type { Graph, GraphNode, NodeKind, NodeProperty, Position } from '../model/types.ts';
import { loadSavedDocument } from './storage.ts';

interface Snapshot {
  graph: Graph;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;
/** Deleting a selection emits node and edge removals back to back; they form one undo step. */
const REMOVE_WINDOW_MS = 50;

export interface PlaygroundState extends Snapshot {
  past: Snapshot[];
  future: Snapshot[];
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  /** Incremented when a whole document is loaded, so the canvas can refit its viewport. */
  docVersion: number;
  notice: string | null;

  addNode: (kind: NodeKind, position: Position) => string;
  updateNode: (id: string, patch: { name?: string }) => void;
  addProperty: (id: string) => void;
  updateProperty: (id: string, index: number, patch: Partial<NodeProperty>) => void;
  removeProperty: (id: string, index: number) => void;
  moveNodes: (positions: Record<string, Position>) => void;
  beginMove: () => void;
  removeNodes: (ids: string[]) => void;
  removeEdges: (ids: string[]) => void;
  connect: (source: string, target: string) => boolean;

  setSelection: (nodeIds: string[], edgeIds: string[]) => void;
  undo: () => void;
  redo: () => void;
  loadDocument: (doc: Pick<PlaygroundDocument, 'graph'>) => void;
  loadPreset: (id: string) => void;
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

function initialGraph(): Graph {
  return loadSavedDocument()?.graph ?? PRESETS[0]!.graph;
}

export const useStore = create<PlaygroundState>()((set, get) => {
  let lastKey: string | null = null;
  let lastTime = 0;
  /** Snapshot taken when a drag starts; only committed to history once a node actually moves. */
  let pendingMove: Snapshot | null = null;

  /** Applies an edit and records undo history (coalescing rapid edits with the same key). */
  const edit = (mutate: (graph: Graph) => Graph | null, key?: string, windowMs = COALESCE_MS) => {
    const { graph, past } = get();
    const next = mutate(graph);
    if (!next) return;
    pendingMove = null;
    const now = Date.now();
    const coalesce = key !== undefined && key === lastKey && now - lastTime < windowMs;
    lastKey = key ?? null;
    lastTime = now;
    const nodeIds = new Set(next.nodes.map((n) => n.id));
    const edgeIds = new Set(next.edges.map((e) => e.id));
    set((s) => ({
      graph: next,
      past: coalesce ? past : [...past, { graph }].slice(-HISTORY_LIMIT),
      future: [],
      selectedNodeIds: s.selectedNodeIds.filter((id) => nodeIds.has(id)),
      selectedEdgeIds: s.selectedEdgeIds.filter((id) => edgeIds.has(id)),
    }));
  };

  const mapNode = (id: string, fn: (n: GraphNode) => GraphNode) => (graph: Graph) => ({
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? fn(n) : n)),
  });

  const restore = (snap: Snapshot, past: Snapshot[], future: Snapshot[]) => {
    const nodeIds = new Set(snap.graph.nodes.map((n) => n.id));
    const edgeIds = new Set(snap.graph.edges.map((e) => e.id));
    lastKey = null;
    pendingMove = null;
    set((s) => ({
      graph: snap.graph,
      past,
      future,
      selectedNodeIds: s.selectedNodeIds.filter((id) => nodeIds.has(id)),
      selectedEdgeIds: s.selectedEdgeIds.filter((id) => edgeIds.has(id)),
    }));
  };

  return {
    graph: initialGraph(),
    past: [],
    future: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    docVersion: 0,
    notice: null,

    addNode: (kind, position) => {
      const id = uniqueId(kind, new Set(get().graph.nodes.map((n) => n.id)));
      const sameKind = get().graph.nodes.filter((n) => n.kind === kind).length;
      const label = NODE_SPECS[kind].label;
      const name = sameKind === 0 ? label : `${label} ${sameKind + 1}`;
      edit((g) => ({ ...g, nodes: [...g.nodes, createNode(kind, id, position, name)] }));
      set({ selectedNodeIds: [id], selectedEdgeIds: [] });
      return id;
    },

    updateNode: (id, patch) => edit(mapNode(id, (n) => ({ ...n, ...patch })), `name:${id}`),

    addProperty: (id) =>
      edit(mapNode(id, (n) => ({ ...n, properties: [...n.properties, { key: '', value: '' }] }))),

    updateProperty: (id, index, patch) =>
      edit(
        mapNode(id, (n) => ({
          ...n,
          properties: n.properties.map((p, i) => (i === index ? { ...p, ...patch } : p)),
        })),
        `property:${id}:${index}:${Object.keys(patch).join(',')}`,
      ),

    removeProperty: (id, index) =>
      edit(mapNode(id, (n) => ({ ...n, properties: n.properties.filter((_, i) => i !== index) }))),

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
      pendingMove = { graph: get().graph };
    },

    removeNodes: (ids) => {
      const existing = new Set(get().graph.nodes.map((n) => n.id));
      const drop = new Set(ids.filter((id) => existing.has(id)));
      if (drop.size === 0) return;
      edit(
        (g) => ({
          nodes: g.nodes.filter((n) => !drop.has(n.id)),
          edges: g.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
        }),
        'remove',
        REMOVE_WINDOW_MS,
      );
    },

    removeEdges: (ids) => {
      const existing = new Set(get().graph.edges.map((e) => e.id));
      const drop = new Set(ids.filter((id) => existing.has(id)));
      if (drop.size === 0) return;
      edit((g) => ({ ...g, edges: g.edges.filter((e) => !drop.has(e.id)) }), 'remove', REMOVE_WINDOW_MS);
    },

    connect: (source, target) => {
      const { graph } = get();
      const src = graph.nodes.find((n) => n.id === source);
      const dst = graph.nodes.find((n) => n.id === target);
      let problem: string | null = null;
      if (!src || !dst) problem = 'Unknown component';
      else if (source === target) problem = 'A component cannot connect to itself';
      else if (!NODE_SPECS[dst.kind].acceptsInput) problem = `${dst.name} cannot receive traffic`;
      else if (graph.edges.some((e) => e.source === source && e.target === target)) problem = 'Already connected';
      else if (reaches(graph, target, source)) problem = 'That connection would create a cycle';
      if (problem) {
        set({ notice: problem });
        return false;
      }
      const id = uniqueId('edge', new Set(graph.edges.map((e) => e.id)));
      edit((g) => ({ ...g, edges: [...g.edges, { id, source, target }] }));
      return true;
    },

    setSelection: (nodeIds, edgeIds) => {
      const s = get();
      const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
      if (same(s.selectedNodeIds, nodeIds) && same(s.selectedEdgeIds, edgeIds)) return;
      set({ selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds });
    },

    undo: () => {
      const { past, future, graph } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      restore(prev, past.slice(0, -1), [{ graph }, ...future]);
    },

    redo: () => {
      const { past, future, graph } = get();
      const next = future[0];
      if (!next) return;
      restore(next, [...past, { graph }], future.slice(1));
    },

    loadDocument: (doc) => {
      const { graph, past } = get();
      lastKey = null;
      pendingMove = null;
      set({
        graph: doc.graph,
        past: [...past, { graph }].slice(-HISTORY_LIMIT),
        future: [],
        selectedNodeIds: [],
        selectedEdgeIds: [],
        docVersion: get().docVersion + 1,
      });
    },

    loadPreset: (id) => {
      const preset = getPreset(id);
      if (preset) get().loadDocument({ graph: preset.graph });
    },

    setNotice: (notice) => set({ notice }),
  };
});
