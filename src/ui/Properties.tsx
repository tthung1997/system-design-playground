import { NODE_SPECS } from '../model/defaults.ts';
import { validateGraph } from '../model/graph.ts';
import { useStore } from '../store/useStore.ts';
import { AlertIcon, CloseIcon, CursorIcon, KindTile, PlusIcon, TrashIcon } from './icons.tsx';

export function Properties() {
  const graph = useStore((s) => s.graph);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useStore((s) => s.selectedEdgeIds);
  const updateNode = useStore((s) => s.updateNode);
  const addProperty = useStore((s) => s.addProperty);
  const updateProperty = useStore((s) => s.updateProperty);
  const removeProperty = useStore((s) => s.removeProperty);
  const removeNodes = useStore((s) => s.removeNodes);
  const removeEdges = useStore((s) => s.removeEdges);

  const total = selectedNodeIds.length + selectedEdgeIds.length;

  if (total === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Properties</h2>
        <div className="flex flex-col items-center gap-2 py-4 text-center text-muted">
          <CursorIcon size={22} />
          <p className="m-0 text-xs leading-relaxed">Select a component or connection to edit it.</p>
        </div>
      </section>
    );
  }

  if (total > 1) {
    return (
      <section className="card">
        <h2 className="card-title">Properties</h2>
        <p className="m-0">
          {selectedNodeIds.length} component(s) and {selectedEdgeIds.length} connection(s) selected.
        </p>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            removeNodes(selectedNodeIds);
            removeEdges(selectedEdgeIds);
          }}
        >
          <TrashIcon size={15} />
          Delete selection
        </button>
      </section>
    );
  }

  const edge = graph.edges.find((e) => e.id === selectedEdgeIds[0]);
  if (edge) {
    const src = graph.nodes.find((n) => n.id === edge.source);
    const dst = graph.nodes.find((n) => n.id === edge.target);
    return (
      <section className="card">
        <h2 className="card-title">Connection</h2>
        <p className="m-0">
          {src?.name} → {dst?.name}
        </p>
        <button type="button" className="btn btn-danger" onClick={() => removeEdges([edge.id])}>
          <TrashIcon size={15} />
          Delete connection
        </button>
      </section>
    );
  }

  const node = graph.nodes.find((n) => n.id === selectedNodeIds[0]);
  if (!node) return null;
  const spec = NODE_SPECS[node.kind];
  const nodeIssues = validateGraph(graph).filter((i) => i.nodeId === node.id);

  return (
    <section className="card">
      <div className="mb-3 flex items-center gap-2.5">
        <KindTile kind={node.kind} size={32} />
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-semibold">{spec.label}</h2>
          <p className="m-0 text-xs text-muted">{spec.description}</p>
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
        <label htmlFor="node-name" className="text-xs font-medium text-muted">
          Name
        </label>
        <input id="node-name" type="text" className="input w-full" value={node.name} onChange={(e) => updateNode(node.id, { name: e.target.value })} />
      </div>

      <h3 className="mt-4 mb-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Custom properties</h3>
      {node.properties.length === 0 && <p className="hint">None yet. Add whatever you want to track, such as region, owner or notes.</p>}
      <ul className="m-0 list-none space-y-1.5 p-0">
        {node.properties.map((p, i) => (
          <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
            <input
              type="text"
              className="input"
              placeholder="Name"
              aria-label={`Property ${i + 1} name`}
              value={p.key}
              onChange={(e) => updateProperty(node.id, i, { key: e.target.value })}
            />
            <input
              type="text"
              className="input font-mono text-[13px]"
              placeholder="Value"
              aria-label={`Property ${i + 1} value`}
              value={p.value}
              onChange={(e) => updateProperty(node.id, i, { value: e.target.value })}
            />
            <button
              type="button"
              className="rounded-md p-1.5 text-muted hover:text-danger"
              aria-label={`Remove property ${i + 1}`}
              onClick={() => removeProperty(node.id, i)}
            >
              <CloseIcon size={14} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn mt-2.5" onClick={() => addProperty(node.id)}>
        <PlusIcon size={15} />
        Add property
      </button>

      {nodeIssues.length > 0 && (
        <ul className="mt-3 mb-0 list-none space-y-1 p-0">
          {nodeIssues.map((i, k) => (
            <li key={k} className="warn">
              <AlertIcon size={14} className="mt-px shrink-0" />
              {i.message}
            </li>
          ))}
        </ul>
      )}

      <div>
        <button type="button" className="btn btn-danger" onClick={() => removeNodes([node.id])}>
          <TrashIcon size={15} />
          Delete component
        </button>
      </div>
    </section>
  );
}
