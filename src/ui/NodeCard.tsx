import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { NODE_SPECS } from '../model/defaults.ts';
import type { GraphNode } from '../model/types.ts';

export interface SdNodeData extends Record<string, unknown> {
  node: GraphNode;
  hasIssue: boolean;
}

export type SdFlowNode = Node<SdNodeData, 'sd'>;

const MAX_SHOWN = 4;

export function NodeCard({ data, selected }: NodeProps<SdFlowNode>) {
  const { node, hasIssue } = data;
  const spec = NODE_SPECS[node.kind];
  const props = node.properties.filter((p) => p.key.trim() !== '' || p.value.trim() !== '');
  const border = selected
    ? 'border-accent shadow-[0_0_0_2px_rgba(37,99,235,0.25)]'
    : hasIssue
      ? 'border-orange-500'
      : 'border-slate-300';

  return (
    <div className={`w-[190px] rounded-[10px] border-[1.5px] bg-white px-2.5 py-2 text-xs shadow-sm ${border}`}>
      {spec.acceptsInput && <Handle type="target" position={Position.Top} />}
      <div className="flex items-center gap-2">
        <span className="text-xl" aria-hidden>
          {spec.icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <strong className="truncate text-[13px]">{node.name}</strong>
          <small className="text-slate-500">{spec.label}</small>
        </div>
      </div>
      {props.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-slate-100 pt-1.5 [&>dd]:m-0 [&>dd]:truncate [&>dt]:truncate [&>dt]:text-slate-500">
          {props.slice(0, MAX_SHOWN).map((p, i) => (
            <div key={i} className="contents">
              <dt>{p.key || '—'}</dt>
              <dd title={p.value}>{p.value}</dd>
            </div>
          ))}
          {props.length > MAX_SHOWN && <dt className="col-span-2">+{props.length - MAX_SHOWN} more</dt>}
        </dl>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
