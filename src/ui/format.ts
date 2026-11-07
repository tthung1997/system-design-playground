export const fmtPct = (v: number | null, digits = 1) => (v === null ? 'n/a' : `${v.toFixed(digits)}%`);
export const fmtRatio = (v: number | null, digits = 1) => (v === null ? 'n/a' : `${(v * 100).toFixed(digits)}%`);
export const fmtMs = (v: number | null) => (v === null ? 'n/a' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
export const fmtUsd = (v: number | null) => (v === null ? 'n/a' : `$${Math.round(v).toLocaleString()}`);
export const fmtRps = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString());
export const fmtSeconds = (v: number | null) => (v === null ? 'never' : v >= 120 ? `${(v / 60).toFixed(1)} min` : `${Math.round(v)} s`);
