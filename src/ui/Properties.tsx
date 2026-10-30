import { NODE_SPECS } from '../model/defaults.ts';
import type { NodeParams } from '../model/types.ts';
import { useStore } from '../store/useStore.ts';
import { fmtMoney, fmtMs, fmtNum, fmtPct } from './format.ts';
import { NumberField } from './NumberField.tsx';
import type { Derived } from './useDerived.ts';

type ScalarKey = Exclude<keyof NodeParams, 'autoscale'>;

interface FieldDef {
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  scale?: number;
  title?: string;
}

const FIELDS: Record<ScalarKey, FieldDef> = {
  instances: { label: 'Instances', min: 0, step: 1, title: 'Fixed instance count (initial count when autoscaling)' },
  capacityPerInstance: { label: 'Capacity / instance', unit: 'rps', min: 0 },
  latencyMs: { label: 'Base latency', unit: 'ms', min: 0, title: 'Latency at low load; grows as utilization approaches 100%' },
  costPerInstanceHour: { label: 'Cost / instance', unit: '$/h', min: 0, step: 0.01 },
  hitRate: { label: 'Hit rate', unit: '%', min: 0, max: 100, scale: 0.01 },
  warmupSec: { label: 'Cache warm-up', unit: 'min', min: 0, scale: 60, title: 'Time for the hit rate to ramp up from a cold start' },
  queueMaxDepth: { label: 'Max backlog', unit: 'msgs', min: 0, title: 'Messages beyond this are dropped' },
  trafficShare: { label: 'Traffic share', min: 0, title: 'Relative share of total offered traffic' },
};

export function Properties({ derived }: { derived: Derived }) {
  const graph = useStore((s) => s.graph);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useStore((s) => s.selectedEdgeIds);
  const updateNode = useStore((s) => s.updateNode);
  const updateParams = useStore((s) => s.updateParams);
  const updateAutoscale = useStore((s) => s.updateAutoscale);
  const updateEdge = useStore((s) => s.updateEdge);
  const removeNodes = useStore((s) => s.removeNodes);
  const removeEdges = useStore((s) => s.removeEdges);
  const { view, issues } = derived;

  const total = selectedNodeIds.length + selectedEdgeIds.length;

  if (total === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Properties</h2>
        <p className="hint">Select a component or connection to edit it.</p>
      </section>
    );
  }

  if (total > 1) {
    return (
      <section className="card">
        <h2 className="card-title">Properties</h2>
        <p>
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
          Delete selection
        </button>
      </section>
    );
  }

  const edge = graph.edges.find((e) => e.id === selectedEdgeIds[0]);
  if (edge) {
    const src = graph.nodes.find((n) => n.id === edge.source);
    const dst = graph.nodes.find((n) => n.id === edge.target);
    const siblings = graph.edges.filter((e) => e.source === edge.source);
    const sum = siblings.reduce((s, e) => s + e.ratio, 0);
    const share = sum > 0 ? edge.ratio / sum : 1 / siblings.length;
    return (
      <section className="card">
        <h2 className="card-title">Connection</h2>
        <p>
          {src?.name} → {dst?.name}
        </p>
        <NumberField
          label="Traffic weight"
          value={edge.ratio}
          min={0}
          step={0.5}
          onChange={(v) => updateEdge(edge.id, v)}
          title="Relative share of the source's forwarded traffic sent along this edge"
        />
        <p className="hint">
          Gets {fmtPct(share, 0)} of {src?.name}'s forwarded traffic
          {view && view.edges[edge.id] !== undefined ? ` (${fmtNum(view.edges[edge.id]!)} rps now)` : ''}.
        </p>
        <button type="button" className="btn btn-danger" onClick={() => removeEdges([edge.id])}>
          Delete connection
        </button>
      </section>
    );
  }

  const node = graph.nodes.find((n) => n.id === selectedNodeIds[0]);
  if (!node) return null;
  const spec = NODE_SPECS[node.kind];
  const m = view?.nodes[node.id];
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);

  return (
    <section className="card">
      <h2 className="card-title">
        {spec.icon} {spec.label}
      </h2>
      <p className="hint">{spec.description}</p>
      <div className="my-1.5 grid grid-cols-[1fr_1.1fr] items-center gap-2">
        <label htmlFor="node-name" className="text-slate-700">
          Name
        </label>
        <div className="flex items-center gap-1">
          <input id="node-name" type="text" className="input w-full" value={node.name} onChange={(e) => updateNode(node.id, { name: e.target.value })} />
        </div>
      </div>
      {spec.fields.map((key) => {
        if (key === 'autoscale') return null;
        const f = FIELDS[key];
        return (
          <NumberField
            key={key}
            label={f.label}
            unit={f.unit}
            min={f.min}
            max={f.max}
            step={f.step}
            scale={f.scale}
            title={f.title}
            value={node.params[key]}
            onChange={(v) => updateParams(node.id, { [key]: v })}
          />
        );
      })}

      {spec.autoscalable && (
        <fieldset className="mt-2 rounded-md border border-slate-200 px-2 pb-1">
          <legend className="px-1">
            <label>
              <input
                type="checkbox"
                checked={node.params.autoscale.enabled}
                onChange={(e) => updateAutoscale(node.id, { enabled: e.target.checked })}
              />{' '}
              Autoscaling
            </label>
          </legend>
          {node.params.autoscale.enabled && (
            <>
              <NumberField label="Min instances" min={0} step={1} value={node.params.autoscale.minInstances} onChange={(v) => updateAutoscale(node.id, { minInstances: v })} />
              <NumberField label="Max instances" min={0} step={1} value={node.params.autoscale.maxInstances} onChange={(v) => updateAutoscale(node.id, { maxInstances: v })} />
              <NumberField label="Target utilization" unit="%" min={1} max={100} scale={0.01} value={node.params.autoscale.targetUtilization} onChange={(v) => updateAutoscale(node.id, { targetUtilization: v })} />
              <NumberField label="Provisioning delay" unit="s" min={0} value={node.params.autoscale.provisionSec} onChange={(v) => updateAutoscale(node.id, { provisionSec: v })} title="Time between requesting an instance and it serving traffic (billed meanwhile)" />
              <NumberField label="Scale-in cooldown" unit="s" min={0} value={node.params.autoscale.cooldownSec} onChange={(v) => updateAutoscale(node.id, { cooldownSec: v })} title="Minimum time after a scaling action before removing instances" />
            </>
          )}
        </fieldset>
      )}

      {nodeIssues.length > 0 && (
        <ul className="my-1.5 list-none space-y-1 p-0 text-xs">
          {nodeIssues.map((i, k) => (
            <li key={k} className={`rounded px-1.5 py-0.5 ${i.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
              {i.message}
            </li>
          ))}
        </ul>
      )}

      {m && node.kind !== 'client' && (
        <dl className="my-2 grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-1 [&>dd]:m-0 [&>dd]:text-right [&>dd]:tabular-nums [&>dt]:text-slate-500">
          <dt className="font-medium">{view?.mode === 'simulation' ? 'At cursor' : 'At peak load'}</dt>
          <dd />
          <dt>Arrival</dt>
          <dd>{fmtNum(m.arrival)} rps</dd>
          <dt>Capacity</dt>
          <dd>{fmtNum(m.capacity)} rps</dd>
          <dt>Utilization</dt>
          <dd>{fmtPct(m.utilization, 0)}</dd>
          <dt>Dropped</dt>
          <dd>{fmtNum(m.dropped)} rps</dd>
          <dt>Latency</dt>
          <dd>{fmtMs(m.latencyMs)}</dd>
          <dt>Instances</dt>
          <dd>
            {fmtNum(m.instances, 0)}
            {m.pendingInstances > 0 ? ` (+${m.pendingInstances} starting)` : ''}
          </dd>
          {node.kind === 'queue' && (
            <>
              <dt>Backlog</dt>
              <dd>{fmtNum(m.backlog, 0)}</dd>
            </>
          )}
          <dt>Cost</dt>
          <dd>{fmtMoney(m.costPerHour)}/h</dd>
        </dl>
      )}

      <button type="button" className="btn btn-danger" onClick={() => removeNodes([node.id])}>
        Delete component
      </button>
    </section>
  );
}
