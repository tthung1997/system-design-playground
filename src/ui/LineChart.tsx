import { useMemo } from 'react';
import { CartesianGrid, ComposedChart, Area, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ChartSeries {
  name: string;
  color: string;
  values: ArrayLike<number>;
  dashed?: boolean;
  area?: boolean;
}

interface Props {
  title: string;
  times: ArrayLike<number>;
  series: ChartSeries[];
  cursor: number;
  onSeek: (index: number) => void;
  format: (v: number) => string;
  /** Formats the time axis labels. */
  formatTime: (sec: number) => string;
}

const MAX_POINTS = 400;

interface Row {
  index: number;
  t: number;
  [series: string]: number;
}

/** Buckets the run into at most MAX_POINTS rows, keeping each bucket's peak so spikes survive. */
function buildRows(times: ArrayLike<number>, series: ChartSeries[]): Row[] {
  const n = times.length;
  const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
  const rows: Row[] = [];
  for (let i = 0; i < n; i += stride) {
    const row: Row = { index: i, t: times[i]! };
    for (const s of series) {
      let best = -Infinity;
      for (let j = i; j < Math.min(i + stride, n); j++) {
        const v = s.values[j]!;
        if (Number.isFinite(v) && v > best) {
          best = v;
        }
      }
      // Infinite or missing values leave a gap rather than distorting the axis.
      row[s.name] = best === -Infinity ? NaN : best;
    }
    rows.push(row);
  }
  return rows;
}

export function LineChart({ title, times, series, cursor, onSeek, format, formatTime }: Props) {
  const n = times.length;
  const rows = useMemo(() => buildRows(times, series), [times, series]);
  const at = Math.min(Math.max(cursor, 0), n - 1);
  const cursorT = n > 0 ? times[at]! : 0;
  const stride = Math.max(1, Math.ceil(n / MAX_POINTS));

  // Maps the hovered row back to a sample index, so seeking stays exact after downsampling.
  const seek = (state: { activeTooltipIndex?: number | string | null }) => {
    const i = Number(state.activeTooltipIndex);
    const row = rows[i];
    if (!row) return;
    onSeek(Math.min(row.index + Math.floor(stride / 2), n - 1));
  };

  return (
    <div className="min-w-0 rounded-lg border border-slate-200 px-2 py-1.5">
      <div className="flex flex-wrap justify-between gap-x-2.5 gap-y-1 text-xs">
        <span className="font-semibold">{title}</span>
        <span className="flex flex-wrap gap-2 text-slate-500">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1">
              <i className="inline-block h-[3px] w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.name}
              <b className="font-semibold text-slate-900 tabular-nums">{n > 0 ? format(s.values[at]!) : ''}</b>
            </span>
          ))}
        </span>
      </div>
      <div className="h-[150px] cursor-col-resize select-none [&_svg:focus:not(:focus-visible)]:outline-none" role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onClick={seek}
            onMouseMove={(state, e) => {
              if ((e as unknown as MouseEvent).buttons === 1) seek(state);
            }}
          >
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[times[0] ?? 0, times[n - 1] ?? 0]}
              tickFormatter={formatTime}
              tick={{ fontSize: 9, fill: '#64748b' }}
              tickCount={5}
              minTickGap={24}
            />
            <YAxis
              width={54}
              tickFormatter={format}
              tick={{ fontSize: 9, fill: '#64748b' }}
              domain={[0, 'auto']}
              allowDecimals
            />
            <Tooltip
              isAnimationActive={false}
              labelFormatter={(t) => formatTime(Number(t))}
              formatter={(v, name) => [format(Number(v)), name]}
              contentStyle={{ fontSize: 11, padding: '4px 8px' }}
            />
            {series.map((s) =>
              s.area ? (
                <Area
                  key={s.name}
                  dataKey={s.name}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                  fill={s.color}
                  fillOpacity={0.12}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.name}
                  dataKey={s.name}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ),
            )}
            <ReferenceLine x={cursorT} stroke="#0f172a" strokeDasharray="3 2" ifOverflow="visible" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
