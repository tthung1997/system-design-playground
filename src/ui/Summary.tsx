import { useStore } from '../store/useStore.ts';
import { fmtDuration, fmtMoney, fmtMs, fmtNum, fmtPct } from './format.ts';
import type { Derived } from './useDerived.ts';

const VERDICT_TONE = {
  bad: 'bg-red-50 text-red-800',
  warn: 'bg-amber-50 text-amber-800',
  good: 'bg-green-50 text-green-800',
} as const;

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={warn ? 'font-semibold text-danger' : undefined}>{value}</dd>
    </>
  );
}

export function Summary({ derived }: { derived: Derived }) {
  const result = useStore((s) => s.result);
  const graph = useStore((s) => s.graph);
  const { analysis, issues, peak } = derived;
  const nameOf = (id: string | null) => graph.nodes.find((n) => n.id === id)?.name ?? '—';

  const sum = result?.summary;
  let verdict: { text: string; tone: 'bad' | 'warn' | 'good' } | null = null;
  if (sum) {
    if (sum.dropRate > 0.001) {
      verdict = {
        tone: 'bad',
        text: `Under-provisioned: ${fmtPct(sum.dropRate, 2)} of requests were dropped (${fmtDuration(sum.secondsOverCapacity)} over capacity).`,
      };
    } else if (sum.peakHeadroom < 1) {
      verdict = {
        tone: 'warn',
        text: `Peak load exceeded steady capacity by ${fmtPct(1 / sum.peakHeadroom - 1, 0)}, but buffering absorbed it without drops. Latency peaked at ${fmtMs(sum.peakLatencyMs)}.`,
      };
    } else if (sum.capacityEfficiency < 0.3) {
      verdict = {
        tone: 'warn',
        text: `Over-provisioned: only ${fmtPct(sum.capacityEfficiency, 0)} of paid capacity was used. Look for savings.`,
      };
    } else {
      verdict = { tone: 'good', text: 'Balanced: peak load was served and capacity was reasonably used.' };
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">{sum ? 'Cost vs peak capacity' : 'Peak-load analysis'}</h2>

      {issues.length > 0 && (
        <ul className="my-1.5 list-none space-y-1 p-0 text-xs">
          {issues.map((i, k) => (
            <li key={k} className={`rounded px-1.5 py-0.5 ${i.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
              {i.message}
            </li>
          ))}
        </ul>
      )}

      {sum && (
        <>
          {verdict && <p className={`mb-1.5 rounded-md px-2 py-1.5 ${VERDICT_TONE[verdict.tone]}`}>{verdict.text}</p>}
          <dl className="my-2 grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-1 [&>dd]:m-0 [&>dd]:text-right [&>dd]:tabular-nums [&>dt]:text-slate-500">
            <Row label="Total cost" value={fmtMoney(sum.totalCost)} />
            <Row label="Average cost" value={`${fmtMoney(sum.avgCostPerHour)}/h`} />
            <Row label="Peak cost" value={`${fmtMoney(sum.peakCostPerHour)}/h`} />
            <Row label="Cost / 1M requests" value={fmtMoney(sum.costPerMillionRequests)} />
            <Row label="Peak load" value={`${fmtNum(sum.peakOffered)} rps`} />
            <Row label="Capacity at peak" value={`${fmtNum(sum.capacityAtPeak)} rps`} warn={sum.peakHeadroom < 1} />
            <Row label="Headroom at peak" value={fmtPct(sum.peakHeadroom - 1, 0)} warn={sum.peakHeadroom < 1} />
            <Row label="Capacity range" value={`${fmtNum(sum.minCapacity)}–${fmtNum(sum.maxCapacity)} rps`} />
            <Row label="Capacity used" value={fmtPct(sum.capacityEfficiency, 0)} />
            <Row label="Requests dropped" value={fmtPct(sum.dropRate, 2)} warn={sum.dropRate > 0.001} />
            <Row label="Time over capacity" value={fmtDuration(sum.secondsOverCapacity)} warn={sum.secondsOverCapacity > 0} />
            <Row label="Latency avg / p95" value={`${fmtMs(sum.avgLatencyMs)} / ${fmtMs(sum.p95LatencyMs)}`} />
            <Row label="Peak latency" value={fmtMs(sum.peakLatencyMs)} />
            {sum.peakBacklog > 0 && <Row label="Peak queue backlog" value={fmtNum(sum.peakBacklog, 0)} />}
          </dl>
        </>
      )}

      {!sum && analysis && (
        <dl className="my-2 grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-1 [&>dd]:m-0 [&>dd]:text-right [&>dd]:tabular-nums [&>dt]:text-slate-500">
          <Row label="Peak load" value={`${fmtNum(peak)} rps`} />
          <Row label="Success rate" value={fmtPct(analysis.successRate, 1)} warn={analysis.successRate < 0.999} />
          <Row label="Avg latency" value={fmtMs(analysis.avgLatencyMs)} />
          <Row label="Cost" value={`${fmtMoney(analysis.costPerHour)}/h`} />
          <Row label="Max throughput" value={`${fmtNum(analysis.maxThroughput)} rps`} />
          <Row label="Headroom" value={Number.isFinite(analysis.headroom) ? fmtPct(analysis.headroom - 1, 0) : '∞'} warn={analysis.headroom < 1} />
          <Row label="Bottleneck" value={nameOf(analysis.bottleneckId)} />
          {analysis.saturatedIds.length > 0 && <Row label="Saturated" value={analysis.saturatedIds.map(nameOf).join(', ')} warn />}
        </dl>
      )}
      {!sum && <p className="hint">Steady-state numbers at the scenario's peak load. Run the simulation to see time-varying behavior.</p>}
    </section>
  );
}
