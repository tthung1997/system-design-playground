import type { Scenario, TrafficProfile } from '../model/types.ts';

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** Noise-free offered rate (requests/second) at time t within a run of the given duration. */
export function profileRate(profile: TrafficProfile, t: number, durationSec: number): number {
  switch (profile.type) {
    case 'constant':
      return Math.max(0, profile.rps);
    case 'daily': {
      const hour = t / 3600;
      const phase = (2 * Math.PI * (hour - profile.peakHour)) / 24;
      const wave = 0.5 + 0.5 * Math.cos(phase);
      return Math.max(0, profile.baseRps + (profile.peakRps - profile.baseRps) * wave);
    }
    case 'spike': {
      const { baseRps, spikeRps, startSec, durationSec: len, rampSec } = profile;
      const end = startSec + len;
      let w = 0;
      if (t >= startSec && t <= end) {
        const ramp = Math.max(rampSec, 0);
        if (ramp === 0) w = 1;
        else w = Math.min(clamp01((t - startSec) / ramp), clamp01((end - t) / ramp));
      }
      return Math.max(0, baseRps + (spikeRps - baseRps) * w);
    }
    case 'ramp': {
      const w = durationSec > 0 ? clamp01(t / durationSec) : 1;
      return Math.max(0, profile.startRps + (profile.endRps - profile.startRps) * w);
    }
    case 'custom': {
      const pts = [...profile.points].sort((a, b) => a.t - b.t);
      if (pts.length === 0) return 0;
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      if (t <= first.t) return Math.max(0, first.rps);
      if (t >= last.t) return Math.max(0, last.rps);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (t <= b.t) {
          const w = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
          return Math.max(0, a.rps + (b.rps - a.rps) * w);
        }
      }
      return Math.max(0, last.rps);
    }
  }
}

/** Highest noise-free rate over the scenario; used for static (peak-load) analysis. */
export function peakRate(scenario: Scenario): number {
  const { durationSec, stepSec, profile } = scenario;
  const steps = Math.max(1, Math.ceil(durationSec / Math.max(stepSec, 1e-6)));
  const stride = Math.max(1, Math.floor(steps / 5000));
  let peak = 0;
  for (let i = 0; i <= steps; i += stride) {
    peak = Math.max(peak, profileRate(profile, Math.min(i * stepSec, durationSec), durationSec));
  }
  return peak;
}

/** Parses "seconds,rps" lines into custom profile points. Returns null on malformed input. */
export function parseCustomPoints(text: string): { t: number; rps: number }[] | null {
  const points: { t: number; rps: number }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[\s,;]+/).map(Number);
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || parts[0]! < 0 || parts[1]! < 0) {
      return null;
    }
    points.push({ t: parts[0]!, rps: parts[1]! });
  }
  return points.length > 0 ? points : null;
}

export function formatCustomPoints(points: { t: number; rps: number }[]): string {
  return points.map((p) => `${p.t}, ${p.rps}`).join('\n');
}
