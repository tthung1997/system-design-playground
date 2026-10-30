import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { NODE_SPECS } from '../model/defaults.ts';
import type { GraphNode, NodeMetrics } from '../model/types.ts';
import { fmtMoney, fmtNum, fmtPct, utilColor } from './format.ts';

export interface SdNodeData extends Record<string, unknown> {
  node: GraphNode;
  metrics?: NodeMetrics;
  bottleneck: boolean;
  hasIssue: boolean;
}

export type SdFlowNode = Node<SdNodeData, 'sd'>;

const Tag = ({ children }: { children: string }) => (
  <em className="ml-1.5 rounded-lg bg-orange-100 px-1.5 py-px text-[10px] text-orange-800 not-italic">{children}</em>
);

export function NodeCard({ data, selected }: NodeProps<SdFlowNode>) {
  const { node, metrics: m, bottleneck, hasIssue } = data;
  const spec = NODE_SPECS[node.kind];
  const isClient = node.kind === 'client';
  const util = m?.utilization ?? 0;
  const overloaded = !!m && !isClient && (m.dropped > 1e-6 || util >= 1);
  const scaling = node.params.autoscale.enabled;
  const instances = m ? m.instances : node.params.instances;

  const border = selected
    ? 'border-accent shadow-[0_0_0_2px_rgba(37,99,235,0.25)]'
    : overloaded
      ? 'border-danger bg-red-50/60'
      : bottleneck
        ? 'border-orange-600'
        : 'border-slate-300';
  const note = 'mt-0.5 text-slate-500';

  return (
    <div className={`w-[190px] rounded-[10px] border-[1.5px] bg-white px-2.5 py-2 text-xs shadow-sm ${border}`}>
      {spec.acceptsInput && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden>
          {spec.icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <strong className="truncate text-[13px]">{node.name}</strong>
          <small className="text-slate-500">
            {spec.label}
            {!isClient && ` · ${fmtNum(instances, 0)}×${scaling ? ' auto' : ''}`}
            {bottleneck && <Tag>bottleneck</Tag>}
            {hasIssue && <Tag>!</Tag>}
          </small>
        </div>
      </div>

      {m && !isClient && (
        <>
          <div className="mt-2 mb-1 h-1.5 overflow-hidden rounded-sm bg-slate-200" title={`Utilization ${fmtPct(util, 0)}`}>
            <div
              className="h-full transition-[width] duration-150"
              style={{ width: `${Math.min(util, 1) * 100}%`, background: utilColor(util) }}
            />
          </div>
          <div className="mt-1 flex justify-between text-slate-700">
            <span>{fmtPct(util, 0)} util</span>
            <span>in {fmtNum(m.arrival)}/s</span>
          </div>
          {m.dropped > 1e-6 && <div className="mt-0.5 font-semibold text-danger">✖ dropping {fmtNum(m.dropped)}/s</div>}
          {node.kind === 'queue' && m.backlog > 0.5 && <div className={note}>backlog {fmtNum(m.backlog, 0)}</div>}
          {(node.kind === 'cache' || node.kind === 'cdn') && <div className={note}>hit rate {fmtPct(m.hitRate, 0)}</div>}
          {m.pendingInstances > 0 && <div className={note}>+{m.pendingInstances} starting…</div>}
          <div className={note}>{fmtMoney(m.costPerHour)}/h</div>
        </>
      )}
      {m && isClient && <div className="mt-1 flex justify-between text-slate-700">{fmtNum(m.arrival)} rps</div>}
      {!m && !isClient && (
        <div className="mt-1 flex justify-between text-slate-700">
          <span>{fmtNum(node.params.capacityPerInstance)} rps/inst</span>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
