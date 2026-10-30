import { useCallback, useEffect, useMemo } from 'react';
import type { DragEvent } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge, EdgeChange, NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { NodeKind, Position } from '../model/types.ts';
import { useStore } from '../store/useStore.ts';
import { fmtNum, fmtPct } from './format.ts';
import { NodeCard } from './NodeCard.tsx';
import type { SdFlowNode } from './NodeCard.tsx';
import type { Derived } from './useDerived.ts';

export const DRAG_MIME = 'application/x-sdp-node-kind';

const nodeTypes = { sd: NodeCard };
const NODE_WIDTH = 190;
const NODE_HEIGHT = 80;

/** Adds a node at the center of the visible canvas (used by palette clicks). */
export function useAddNodeAtCenter() {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useStore((s) => s.addNode);
  return useCallback(
    (kind: NodeKind) => {
      const el = document.querySelector('.react-flow');
      const rect = el?.getBoundingClientRect();
      const jitter = (useStore.getState().graph.nodes.length % 5) * 18;
      const p = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2 + jitter, y: rect.top + rect.height / 2 + jitter })
        : { x: 0, y: 0 };
      addNode(kind, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
    },
    [addNode, screenToFlowPosition],
  );
}

export function Editor({ derived }: { derived: Derived }) {
  const graph = useStore((s) => s.graph);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useStore((s) => s.selectedEdgeIds);
  const docVersion = useStore((s) => s.docVersion);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const { view, issues } = derived;

  useEffect(() => {
    if (docVersion === 0) return;
    const id = requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300 }));
    return () => cancelAnimationFrame(id);
  }, [docVersion, fitView]);

  const nodes = useMemo<SdFlowNode[]>(() => {
    const issueNodes = new Set(issues.filter((i) => i.nodeId).map((i) => i.nodeId));
    const selected = new Set(selectedNodeIds);
    return graph.nodes.map((node) => {
      const metrics = view?.nodes[node.id];
      return {
        id: node.id,
        type: 'sd',
        position: node.position,
        selected: selected.has(node.id),
        data: {
          node,
          metrics,
          bottleneck: !!metrics && view?.bottleneckId === node.id && metrics.utilization >= 0.8,
          hasIssue: issueNodes.has(node.id),
        },
      };
    });
  }, [graph.nodes, selectedNodeIds, view, issues]);

  const edges = useMemo<Edge[]>(() => {
    const selected = new Set(selectedEdgeIds);
    const outCount: Record<string, number> = {};
    const outTotal: Record<string, number> = {};
    for (const e of graph.edges) {
      outCount[e.source] = (outCount[e.source] ?? 0) + 1;
      outTotal[e.source] = (outTotal[e.source] ?? 0) + e.ratio;
    }
    const maxFlow = view ? Math.max(1e-9, ...Object.values(view.edges)) : 1;
    return graph.edges.map((e) => {
      const flow = view?.edges[e.id] ?? 0;
      const target = view?.nodes[e.target];
      const hot = !!target && (target.dropped > 1e-6 || target.utilization >= 1);
      const warm = !!target && target.utilization >= 0.85;
      const color = hot ? '#dc2626' : warm ? '#ea580c' : '#64748b';
      const parts: string[] = [];
      if ((outCount[e.source] ?? 0) > 1) {
        const total = outTotal[e.source] ?? 0;
        parts.push(fmtPct(total > 0 ? e.ratio / total : 1 / outCount[e.source]!, 0));
      }
      if (view && flow > 1e-6) parts.push(`${fmtNum(flow)}/s`);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        selected: selected.has(e.id),
        label: parts.join(' · ') || undefined,
        animated: flow > 1e-6,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 1.5 + 4 * Math.min(1, flow / maxFlow) },
        labelStyle: { fontSize: 11, fill: '#334155' },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
      };
    });
  }, [graph.edges, selectedEdgeIds, view]);

  const onNodesChange = useCallback((changes: NodeChange<SdFlowNode>[]) => {
    const s = useStore.getState();
    const moves: Record<string, Position> = {};
    const removes: string[] = [];
    let selection: Set<string> | null = null;
    for (const c of changes) {
      if (c.type === 'position' && c.position) moves[c.id] = c.position;
      else if (c.type === 'remove') removes.push(c.id);
      else if (c.type === 'select') {
        selection ??= new Set(s.selectedNodeIds);
        if (c.selected) selection.add(c.id);
        else selection.delete(c.id);
      }
    }
    if (Object.keys(moves).length > 0) s.moveNodes(moves);
    if (removes.length > 0) s.removeNodes(removes);
    if (selection) useStore.getState().setSelection([...selection], useStore.getState().selectedEdgeIds);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const s = useStore.getState();
    const removes: string[] = [];
    let selection: Set<string> | null = null;
    for (const c of changes) {
      if (c.type === 'remove') removes.push(c.id);
      else if (c.type === 'select') {
        selection ??= new Set(s.selectedEdgeIds);
        if (c.selected) selection.add(c.id);
        else selection.delete(c.id);
      }
    }
    if (removes.length > 0) s.removeEdges(removes);
    if (selection) useStore.getState().setSelection(useStore.getState().selectedNodeIds, [...selection]);
  }, []);

  const onConnect = useCallback((c: Connection) => {
    useStore.getState().connect(c.source, c.target);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData(DRAG_MIME) as NodeKind;
      if (!kind) return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      useStore.getState().addNode(kind, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
    },
    [screenToFlowPosition],
  );

  return (
    <ReactFlow<SdFlowNode, Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDragStart={() => useStore.getState().beginMove()}
      onDragOver={onDragOver}
      onDrop={onDrop}
      deleteKeyCode={['Backspace', 'Delete']}
      multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: false }}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
