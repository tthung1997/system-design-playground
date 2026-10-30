import { useMemo } from 'react';
import { useStore } from '../store/useStore.ts';
import { fmtClock, fmtMoney, fmtMs, fmtNum } from './format.ts';
import { LineChart } from './LineChart.tsx';
import type { ChartSeries } from './LineChart.tsx';

const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d'];

export function Charts() {
  const result = useStore((s) => s.result);
  const cursor = useStore((s) => s.cursor);
  const graph = useStore((s) => s.graph);
  const setCursor = useStore((s) => s.setCursor);

  const charts = useMemo(() => {
    if (!result) return null;
    const load: ChartSeries[] = [
      { name: 'Offered', color: '#2563eb', values: result.offered, area: true },
      { name: 'Served', color: '#16a34a', values: result.completed },
      { name: 'Dropped', color: '#dc2626', values: result.dropped },
      { name: 'Capacity', color: '#9333ea', values: result.capacity, dashed: true },
    ];
    const latency: ChartSeries[] = [{ name: 'Avg latency', color: '#d97706', values: result.latencyMs, area: true }];
    const cost: ChartSeries[] = [{ name: 'Rate', color: '#0891b2', values: result.costPerHour, area: true }];
    const total: ChartSeries[] = [{ name: 'Total', color: '#db2777', values: result.cumulativeCost, area: true }];

    const instances: ChartSeries[] = graph.nodes
      .filter((n) => n.params.autoscale.enabled && result.nodes[n.id])
      .map((n, i) => ({ name: n.name, color: PALETTE[i % PALETTE.length]!, values: result.nodes[n.id]!.instances }));
    const backlog: ChartSeries[] = graph.nodes
      .filter((n) => n.kind === 'queue' && result.nodes[n.id])
      .map((n, i) => ({ name: n.name, color: PALETTE[i % PALETTE.length]!, values: result.nodes[n.id]!.backlog, area: true }));
    return { load, latency, cost, total, instances, backlog };
  }, [result, graph.nodes]);

  if (!result || !charts) {
    return <div className="p-3.5 text-slate-500">Run the simulation to see load, latency and cost over time.</div>;
  }

  const withDay = result.scenario.durationSec > 86400;
  const common = {
    times: result.times,
    cursor,
    onSeek: setCursor,
    formatTime: (sec: number) => fmtClock(sec, withDay),
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2.5 overflow-y-auto px-3.5 py-2.5">
      <LineChart title="Load vs capacity (rps)" series={charts.load} format={(v) => fmtNum(v)} {...common} />
      <LineChart title="Cost rate ($/h)" series={charts.cost} format={fmtMoney} {...common} />
      <LineChart title="Cumulative cost ($)" series={charts.total} format={fmtMoney} {...common} />
      <LineChart title="Latency" series={charts.latency} format={fmtMs} {...common} />
      {charts.instances.length > 0 && (
        <LineChart title="Autoscaled instances" series={charts.instances} format={(v) => fmtNum(v, 0)} {...common} />
      )}
      {charts.backlog.length > 0 && (
        <LineChart title="Queue backlog (msgs)" series={charts.backlog} format={(v) => fmtNum(v, 0)} {...common} />
      )}
    </div>
  );
}
