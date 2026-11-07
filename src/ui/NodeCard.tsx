import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { CONFIG_FIELDS, NODE_SPECS } from '../model/defaults.ts';
import type { GraphNode } from '../model/types.ts';
import { resolveConfig } from '../simulation/catalog.ts';
import type { NodeDiagnostics } from '../simulation/simulate.ts';
import { fmtRps } from './format.ts';
import { AlertIcon, KindTile } from './icons.tsx';

export interface SdNodeData extends Record<string, unknown> {
  node: GraphNode;
  hasIssue: boolean;
  /** Present while a simulation overlay is shown. */
  diag?: NodeDiagnostics;
  bottleneck?: boolean;
}

export type SdFlowNode = Node<SdNodeData, 'sd'>;

const MAX_SHOWN = 4;

function UtilizationBar({ diag, bottleneck }: { diag: NodeDiagnostics; bottleneck: boolean }) {
  if (diag.arrivalRps <= 0) return <div className="mt-2 border-t border-dashed border-line pt-1.5 text-[11px] text-muted">No traffic</div>;
  const util = diag.utilization;
  const color = util > 1 + 1e-6 ? 'bg-danger' : util > 0.8 ? 'bg-amber-500' : 'bg-accent';
  const label = Number.isFinite(util) ? `${Math.round(util * 100)}%` : 'over capacity';
  return (
    <div className="mt-2 border-t border-dashed border-line pt-1.5" role="img" aria-label={`Utilization ${label}`}>
      <div className="flex items-center justify-between text-[11px]">
        <span className={bottleneck ? 'font-semibold text-danger' : 'text-muted'}>{bottleneck ? 'Bottleneck' : 'Load'}</span>
        <span className="font-mono">
          {fmtRps(diag.arrivalRps)} rps · {label}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, Number.isFinite(util) ? util * 100 : 100)}%` }} />
      </div>
    </div>
  );
}

export function NodeCard({ data, selected }: NodeProps<SdFlowNode>) {
  const { node, hasIssue, diag, bottleneck } = data;
  const spec = NODE_SPECS[node.kind];
  const props = node.properties.filter((p) => p.key.trim() !== '' || p.value.trim() !== '');
  const border = selected ? 'border-accent ring-2 ring-accent/30' : hasIssue ? 'border-amber-500' : 'border-line hover:border-accent/60';
  const fields = CONFIG_FIELDS[node.kind];
  const cfg = resolveConfig(node);
  const detail = [fields.size ? cfg.size : null, fields.replicas && cfg.replicas > 1 ? `×${cfg.replicas}` : null].filter(Boolean).join(' ');

  return (
    <div className={`w-[190px] rounded-xl border bg-panel px-3 py-2.5 text-xs shadow-(--elevation) transition-colors ${border}`}>
      {spec.acceptsInput && <Handle type="target" position={Position.Top} />}
      <div className="flex items-center gap-2.5">
        <KindTile kind={node.kind} />
        <div className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate text-[13px] text-ink">{node.name}</strong>
          <small className="truncate text-muted">
            {spec.label}
            {detail ? ` · ${detail}` : ''}
          </small>
        </div>
        {hasIssue && <AlertIcon size={14} className="shrink-0 text-amber-500" aria-label="Has a warning" />}
      </div>
      {diag && <UtilizationBar diag={diag} bottleneck={!!bottleneck} />}
      {props.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 border-t border-dashed border-line pt-2 [&>dd]:m-0 [&>dd]:truncate [&>dd]:font-mono [&>dt]:truncate [&>dt]:text-muted">
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
