import { useEffect, useMemo, useState } from 'react';
import { simulate } from '../simulation/simulate.ts';
import type { SimResult } from '../simulation/simulate.ts';
import { useStore } from '../store/useStore.ts';
import type { Overlay } from './Editor.tsx';
import { fmtMs, fmtRatio, fmtSeconds, fmtUsd } from './format.ts';
import { AlertIcon } from './icons.tsx';

/** Simulates the current diagram and workload, including the worst single-replica failure. */
export function useSimulation(enabled = true): SimResult | null {
  const graph = useStore((s) => s.graph);
  const workload = useStore((s) => s.workload);
  return useMemo(() => (enabled ? simulate(graph, workload, { failure: 'worst-single-replica' }) : null), [enabled, graph, workload]);
}

export function overlayOf(result: SimResult | null): Overlay | null {
  return result && result.ok ? { nodes: result.nodes, edges: result.edges, bottleneckId: result.bottleneckId } : null;
}

function NumberField({
  id,
  label,
  value,
  onCommit,
  suffix,
  step = 1,
  min,
  max,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (value: number) => void;
  suffix: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft((d) => (Number(d) === value ? d : String(value)));
  }, [value]);
  return (
    <>
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          className="input w-full font-mono"
          value={draft}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(n)) onCommit(n);
          }}
          onBlur={() => setDraft(String(value))}
        />
        <span className="w-8 shrink-0 text-[11px] text-muted">{suffix}</span>
      </div>
    </>
  );
}

/** Traffic controls for the playground and lessons. Challenges use fixed scenarios instead. */
export function WorkloadCard() {
  const workload = useStore((s) => s.workload);
  const setWorkload = useStore((s) => s.setWorkload);
  return (
    <section className="card" aria-label="Workload">
      <h2 className="card-title">Workload</h2>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
        <NumberField id="wl-rps" label="Traffic" value={workload.rps} suffix="rps" min={0} onCommit={(rps) => setWorkload({ rps })} />
        <NumberField
          id="wl-read"
          label="Reads"
          value={Math.round(workload.readRatio * 100)}
          suffix="%"
          min={0}
          max={100}
          onCommit={(p) => setWorkload({ readRatio: p / 100 })}
        />
        <NumberField id="wl-dur" label="Duration" value={workload.durationSec} suffix="s" min={1} onCommit={(durationSec) => setWorkload({ durationSec })} />
      </div>
      <p className="hint">Requests per second arriving at the clients. The rest of the requests are writes. Duration matters for queue backlog.</p>
    </section>
  );
}

function Stat({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: 'bad' | 'ok' }) {
  return (
    <div className="rounded-lg border border-line bg-app px-2.5 py-1.5" title={title}>
      <div className="text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">{label}</div>
      <div className={`font-mono text-[15px] font-semibold ${tone === 'bad' ? 'text-danger' : ''}`}>{value}</div>
    </div>
  );
}

/** Estimates produced by the educational model; the heading and footnote say so. */
export function ResultsCard({ result, names }: { result: SimResult | null; names: Record<string, string> }) {
  if (!result) return null;
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  const queue = result.queue;
  const f = result.failure;
  return (
    <section className="card" aria-label="Simulation results">
      <h2 className="card-title">Estimated results</h2>
      {errors.length > 0 ? (
        <ul className="m-0 list-none space-y-1.5 p-0">
          {errors.map((i, k) => (
            <li key={k} className="warn">
              <AlertIcon size={14} className="mt-px shrink-0" />
              {i.message}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Served" value={fmtRatio(result.servedRatio)} tone={(result.servedRatio ?? 1) < 0.999 ? 'bad' : undefined} title="Share of requests that complete" />
            <Stat label="Cost" value={`${fmtUsd(result.monthlyCostUsd)}/mo`} title="Every provisioned component, even unused ones" />
            <Stat label="Mean latency" value={fmtMs(result.meanLatencyMs)} title="Average over completed requests" />
            <Stat label="Worst path" value={fmtMs(result.tailLatencyMs)} title="Slowest path that carries traffic (a tail estimate, not a percentile)" />
            <Stat label="Availability" value={fmtRatio(result.availability, 3)} title="Chance enough replicas are up to carry the load, assuming independent failures" />
            <Stat label="Bottleneck" value={result.bottleneckId ? (names[result.bottleneckId] ?? result.bottleneckId) : 'none'} title="Component with the highest utilization" />
          </div>
          {f && (
            <p className="hint">
              If one <strong>{f.nodeName}</strong> replica fails: <strong>{fmtRatio(f.servedRatio)}</strong> served
              {f.queue ? `, backlog drains in ${fmtSeconds(f.queue.drainSeconds)}` : ''}.
            </p>
          )}
          {queue && (
            <p className="hint">
              Queue: arrivals {Math.round(queue.arrivalRps).toLocaleString()}/s, drain {Math.round(queue.drainRps).toLocaleString()}/s, peak backlog{' '}
              {Math.round(queue.maxBacklog).toLocaleString()}, lost {Math.round(queue.lostMessages).toLocaleString()}, empty {fmtSeconds(queue.drainSeconds)} after the burst.
            </p>
          )}
        </>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 mb-0 list-none space-y-1.5 p-0">
          {warnings.map((i, k) => (
            <li key={k} className="warn">
              <AlertIcon size={14} className="mt-px shrink-0" />
              {i.message}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Deterministic model estimates, not measurements. See the README for the formulas.</p>
    </section>
  );
}
