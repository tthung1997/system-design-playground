import type { SimulationResult } from './simulate.ts';

export interface SimulationSummary {
  durationSec: number;
  totalRequests: number;
  completedRequests: number;
  droppedRequests: number;
  /** Fraction of offered requests that were dropped. */
  dropRate: number;
  peakOffered: number;
  /** Sustainable throughput when offered load peaked. */
  capacityAtPeak: number;
  /** capacityAtPeak / peakOffered; below 1 means the peak could not be served. */
  peakHeadroom: number;
  minCapacity: number;
  maxCapacity: number;
  /** Total offered requests / total capacity-seconds; how much of the paid capacity is used. */
  capacityEfficiency: number;
  totalCost: number;
  avgCostPerHour: number;
  peakCostPerHour: number;
  costPerMillionRequests: number;
  /** Seconds in which more than 0.1% of requests were dropped. */
  secondsOverCapacity: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  peakLatencyMs: number;
  peakBacklog: number;
}

const finite = (x: number) => Number.isFinite(x);

export function summarize(r: Omit<SimulationResult, 'summary'>): SimulationSummary {
  const dt = r.scenario.stepSec;
  let totalRequests = 0;
  let completedRequests = 0;
  let droppedRequests = 0;
  let capacitySeconds = 0;
  let offeredWithCapacity = 0;
  let totalCost = 0;
  let peakCost = 0;
  let secondsOver = 0;
  let latencyWeighted = 0;
  let peakLatency = 0;
  let peakOffered = 0;
  let peakIndex = 0;
  let minCap = Infinity;
  let maxCap = 0;

  for (let i = 0; i < r.steps; i++) {
    const off = r.offered[i]!;
    totalRequests += off * dt;
    completedRequests += r.completed[i]! * dt;
    droppedRequests += r.dropped[i]! * dt;
    totalCost += (r.costPerHour[i]! * dt) / 3600;
    peakCost = Math.max(peakCost, r.costPerHour[i]!);
    if (off > 0 && r.dropped[i]! > off * 0.001) secondsOver += dt;
    latencyWeighted += r.latencyMs[i]! * r.completed[i]! * dt;
    peakLatency = Math.max(peakLatency, r.latencyMs[i]!);
    if (off > peakOffered) {
      peakOffered = off;
      peakIndex = i;
    }
    const cap = r.capacity[i]!;
    if (finite(cap)) {
      capacitySeconds += cap * dt;
      offeredWithCapacity += off * dt;
      minCap = Math.min(minCap, cap);
      maxCap = Math.max(maxCap, cap);
    }
  }

  const sorted = Array.from(r.latencyMs).sort((a, b) => a - b);
  const p95 = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0;
  const capacityAtPeak = r.steps > 0 ? r.capacity[peakIndex]! : 0;
  const durationSec = r.steps * dt;
  let peakBacklog = 0;
  for (const series of Object.values(r.nodes)) {
    for (let i = 0; i < r.steps; i++) peakBacklog = Math.max(peakBacklog, series.backlog[i]!);
  }

  return {
    durationSec,
    totalRequests,
    completedRequests,
    droppedRequests,
    dropRate: totalRequests > 0 ? droppedRequests / totalRequests : 0,
    peakOffered,
    capacityAtPeak,
    peakHeadroom: peakOffered > 0 ? capacityAtPeak / peakOffered : Infinity,
    minCapacity: finite(minCap) ? minCap : 0,
    maxCapacity: maxCap,
    capacityEfficiency: capacitySeconds > 0 ? offeredWithCapacity / capacitySeconds : 0,
    totalCost,
    avgCostPerHour: durationSec > 0 ? (totalCost * 3600) / durationSec : 0,
    peakCostPerHour: peakCost,
    costPerMillionRequests: completedRequests > 0 ? (totalCost / completedRequests) * 1e6 : 0,
    secondsOverCapacity: secondsOver,
    avgLatencyMs: completedRequests > 0 ? latencyWeighted / completedRequests : 0,
    p95LatencyMs: p95,
    peakLatencyMs: peakLatency,
    peakBacklog,
  };
}
