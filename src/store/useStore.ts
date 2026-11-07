import { create } from 'zustand';
import type { WorkspaceSnapshot } from '../learning/data.ts';
import { createNode, CONFIG_FIELDS, DEFAULT_WORKLOAD, MAX_REPLICAS, NODE_SPECS, SIZE_TIERS, workloadError } from '../model/defaults.ts';
import type { PlaygroundDocument } from '../model/document.ts';
import { getPreset, PRESETS } from '../model/presets.ts';
import type { Graph, GraphNode, NodeConfig, NodeKind, NodeProperty, Position, Workload } from '../model/types.ts';
import { flushPending, loadWorkspace, markBaseline, PLAYGROUND, saveIfChanged } from './workspaces.ts';
import type { WorkspaceKey } from './workspaces.ts';
import { loadSavedDocument } from './storage.ts';

interface Snapshot {
  graph: Graph;
  workload: Workload;
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
  /** Which workspace (playground, a lesson or a challenge) the editor currently shows. */
  workspace: WorkspaceKey;

  addNode: (kind: NodeKind, position: Position) => string;
  updateNode: (id: string, patch: { name?: string }) => void;
  updateConfig: (id: string, patch: { [K in keyof NodeConfig]?: NodeConfig[K] | undefined }) => boolean;
  setWorkload: (patch: Partial<Workload>) => boolean;
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
  loadDocument: (doc: Pick<PlaygroundDocument, 'graph'> & { workload?: Workload }) => void;
  loadPreset: (id: string) => void;
  setNotice: (notice: string | null) => void;
  /**
   * Shows another workspace: saves the current one, then loads its saved draft (or `seed`).
   * Selection and undo history never carry over between workspaces.
   */
  switchWorkspace: (key: WorkspaceKey, seed: WorkspaceSnapshot) => void;
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

function initialSnapshot(): Snapshot {
  const doc = loadSavedDocument();
  return doc
    ? { graph: doc.graph, workload: doc.workload ?? DEFAULT_WORKLOAD }
    : { graph: PRESETS[0]!.graph, workload: DEFAULT_WORKLOAD };
}

export const useStore = create<PlaygroundState>()((set, get) => {
  let lastKey: string | null = null;
  let lastTime = 0;
  /** Snapshot taken when a drag starts; only committed to history once a node actually moves. */
  let pendingMove: Snapshot | null = null;

  const snap = (): Snapshot => ({ graph: get().graph, workload: get().workload });

  /** Records undo history for a new snapshot (coalescing rapid edits with the same key). */
  const commit = (next: Snapshot, key?: string, windowMs = COALESCE_MS) => {
    const { past } = get();
    const before = snap();
    pendingMove = null;
    const now = Date.now();
    const coalesce = key !== undefined && key === lastKey && now - lastTime < windowMs;
    lastKey = key ?? null;
    lastTime = now;
    const nodeIds = new Set(next.graph.nodes.map((n) => n.id));
    const edgeIds = new Set(next.graph.edges.map((e) => e.id));
    set((s) => ({
      graph: next.graph,
      workload: next.workload,
      past: coalesce ? past : [...past, before].slice(-HISTORY_LIMIT),
      future: [],
      selectedNodeIds: s.selectedNodeIds.filter((id) => nodeIds.has(id)),
      selectedEdgeIds: s.selectedEdgeIds.filter((id) => edgeIds.has(id)),
    }));
  };

  /** Applies a graph edit and records undo history. */
  const edit = (mutate: (graph: Graph) => Graph | null, key?: string, windowMs = COALESCE_MS) => {
    const next = mutate(get().graph);
    if (!next) return;
    commit({ graph: next, workload: get().workload }, key, windowMs);
  };

  const mapNode = (id: string, fn: (n: GraphNode) => GraphNode) => (graph: Graph) => ({
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? fn(n) : n)),
  });

  const restore = (target: Snapshot, past: Snapshot[], future: Snapshot[]) => {
    const nodeIds = new Set(target.graph.nodes.map((n) => n.id));
    const edgeIds = new Set(target.graph.edges.map((e) => e.id));
    lastKey = null;
    pendingMove = null;
    set((s) => ({
      graph: target.graph,
      workload: target.workload,
      past,
      future,
      selectedNodeIds: s.selectedNodeIds.filter((id) => nodeIds.has(id)),
      selectedEdgeIds: s.selectedEdgeIds.filter((id) => edgeIds.has(id)),
    }));
  };

  return {
    ...initialSnapshot(),
    past: [],
    future: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    docVersion: 0,
    notice: null,
    workspace: PLAYGROUND,

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

    updateConfig: (id, patch) => {
      const node = get().graph.nodes.find((n) => n.id === id);
      if (!node) return false;
      const fields = CONFIG_FIELDS[node.kind];
      let problem: string | null = null;
      if (patch.replicas !== undefined) {
        if (!fields.replicas) problem = `${node.name} does not support replicas`;
        else if (!Number.isInteger(patch.replicas) || patch.replicas < 1 || patch.replicas > MAX_REPLICAS) {
          problem = `Replicas must be a whole number from 1 to ${MAX_REPLICAS}`;
        }
      }
      if (patch.size !== undefined && (!fields.size || !SIZE_TIERS.includes(patch.size))) problem = `${node.name} does not support that size`;
      if (problem) {
        set({ notice: problem });
        return false;
      }
      edit(
        mapNode(id, (n) => {
          const config: NodeConfig = { ...n.config };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete config[k as keyof NodeConfig];
            else (config as Record<string, unknown>)[k] = v;
          }
          const { config: _old, ...rest } = n;
          void _old;
          return Object.keys(config).length > 0 ? { ...rest, config } : rest;
        }),
        `config:${id}:${Object.keys(patch).join(',')}`,
      );
      return true;
    },

    setWorkload: (patch) => {
      const next = { ...get().workload, ...patch };
      const problem = workloadError(next);
      if (problem) {
        set({ notice: problem });
        return false;
      }
      commit({ graph: get().graph, workload: next }, `workload:${Object.keys(patch).join(',')}`);
      return true;
    },

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
      pendingMove = snap();
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
      const { past, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      restore(prev, past.slice(0, -1), [snap(), ...future]);
    },

    redo: () => {
      const { past, future } = get();
      const next = future[0];
      if (!next) return;
      restore(next, [...past, snap()], future.slice(1));
    },

    loadDocument: (doc) => {
      const { past } = get();
      lastKey = null;
      pendingMove = null;
      set({
        graph: doc.graph,
        workload: doc.workload ?? get().workload,
        past: [...past, snap()].slice(-HISTORY_LIMIT),
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

    switchWorkspace: (key, seed) => {
      if (get().workspace === key) return;
      flushPending();
      const error = saveIfChanged(get().workspace, snap());
      if (error) set({ notice: error });
      const target = loadWorkspace(key) ?? seed;
      markBaseline(key, target);
      lastKey = null;
      pendingMove = null;
      set({
        workspace: key,
        graph: target.graph,
        workload: target.workload,
        past: [],
        future: [],
        selectedNodeIds: [],
        selectedEdgeIds: [],
        docVersion: get().docVersion + 1,
      });
    },
  };
});
