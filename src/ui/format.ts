export function fmtNum(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${trim(v / 1e9, digits)}B`;
  if (a >= 1e6) return `${trim(v / 1e6, digits)}M`;
  if (a >= 1e4) return `${trim(v / 1e3, digits)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return trim(v, digits);
  return trim(v, 2);
}

function trim(v: number, digits: number): string {
  return v.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, '$1');
}

export const fmtRps = (v: number) => `${fmtNum(v)} rps`;

export function fmtMoney(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `$${fmtNum(v)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtMs(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  if (v >= 10000) return `${(v / 1000).toFixed(0)} s`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)} s`;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ms`;
}

export function fmtPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '∞';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  if (sec < 120) return `${Math.round(sec)} s`;
  if (sec < 7200) return `${Math.round(sec / 60)} min`;
  const h = sec / 3600;
  return `${h >= 100 ? h.toFixed(0) : h.toFixed(1).replace(/\.0$/, '')} h`;
}

/** Clock-style label for a simulation time: "d1 14:32" or "12:05" for short runs. */
export function fmtClock(sec: number, withDay: boolean): string {
  const total = Math.floor(sec);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const base = total < 3600 * 2 && !withDay ? `${hm}:${String(s).padStart(2, '0')}` : hm;
  return withDay ? `d${d + 1} ${base}` : base;
}

/** Utilization → color from green through amber to red. */
export function utilColor(u: number): string {
  if (!Number.isFinite(u) || u >= 1) return '#dc2626';
  if (u >= 0.85) return '#ea580c';
  if (u >= 0.6) return '#d97706';
  return '#16a34a';
}
