import { describe, expect, it } from 'vitest';
import { analyze, GraphError, simulate, validateGraph, nodeMetricsAt } from './index.ts';
import { profileRate, parseCustomPoints, peakRate } from './traffic.ts';
import { createNode } from '../model/defaults.ts';
import type { Graph, NodeKind, NodeParams, Scenario, TrafficProfile } from '../model/types.ts';
import { PRESETS } from '../model/presets.ts';

function g(
  nodes: [string, NodeKind, Partial<NodeParams>?][],
  edges: [string, string, number?][],
): Graph {
  return {
    nodes: nodes.map(([id, kind, o], i) => createNode(kind, id, { x: i * 100, y: 0 }, o, id)),
    edges: edges.map(([source, target, ratio], i) => ({ id: `e${i}`, source, target, ratio: ratio ?? 1 })),
  };
}

const scenario = (over: Partial<Scenario> = {}): Scenario => ({
  profile: { type: 'constant', rps: 100 },
  durationSec: 600,
  stepSec: 10,
  noise: 0,
  seed: 1,
  ...over,
});

describe('analyze (steady state)', () => {
  it('propagates load and computes utilization', () => {
    const graph = g(
      [
        ['c', 'client'],
        ['s', 'service', { instances: 2, capacityPerInstance: 100 }],
        ['d', 'database', { instances: 1, capacityPerInstance: 400 }],
      ],
      [
        ['c', 's'],
        ['s', 'd'],
      ],
    );
    const a = analyze(graph, 100);
    expect(a.nodes.s!.arrival).toBeCloseTo(100);
    expect(a.nodes.s!.utilization).toBeCloseTo(0.5);
    expect(a.nodes.d!.utilization).toBeCloseTo(0.25);
    expect(a.successRate).toBeCloseTo(1);
    expect(a.dropped).toBeCloseTo(0);
    expect(a.maxThroughput).toBeCloseTo(200);
    expect(a.bottleneckId).toBe('s');
    expect(a.headroom).toBeCloseTo(2);
    expect(a.costPerHour).toBeCloseTo(2 * 0.1 + 0.5);
  });

  it('drops traffic beyond the bottleneck and conserves requests', () => {
    const graph = g(
      [
        ['c', 'client'],
        ['s', 'service', { instances: 1, capacityPerInstance: 100 }],
        ['d', 'database', { capacityPerInstance: 60 }],
      ],
      [
        ['c', 's'],
        ['s', 'd'],
      ],
    );
    const a = analyze(graph, 150);
    expect(a.nodes.s!.dropped).toBeCloseTo(50);
    expect(a.nodes.d!.dropped).toBeCloseTo(40);
    expect(a.completed).toBeCloseTo(60);
    expect(a.completed + a.dropped).toBeCloseTo(150);
    expect(a.successRate).toBeCloseTo(0.4);
    expect(a.saturatedIds).toEqual(['s', 'd']);
    expect(a.bottleneckId).toBe('d');
  });

  it('splits traffic across edges by ratio', () => {
    const graph = g(
      [
        ['c', 'client'],
        ['lb', 'loadBalancer'],
        ['a', 'service', { capacityPerInstance: 1000 }],
        ['b', 'service', { capacityPerInstance: 1000 }],
      ],
      [
        ['c', 'lb'],
        ['lb', 'a', 3],
        ['lb', 'b', 1],
      ],
    );
    const a = analyze(graph, 400);
    expect(a.nodes.a!.arrival).toBeCloseTo(300);
    expect(a.nodes.b!.arrival).toBeCloseTo(100);
    expect(a.completed).toBeCloseTo(400);
  });

  it('shields downstream nodes with cache hits and shortens latency', () => {
    const withCache = g(
      [
        ['c', 'client'],
        ['cache', 'cache', { hitRate: 0.8, latencyMs: 2, capacityPerInstance: 100000 }],
        ['d', 'database', { capacityPerInstance: 1000, latencyMs: 20 }],
      ],
      [
        ['c', 'cache'],
        ['cache', 'd'],
      ],
    );
    const a = analyze(withCache, 500);
    expect(a.nodes.d!.arrival).toBeCloseTo(100);
    expect(a.nodes.cache!.completed).toBeCloseTo(400);
    expect(a.completed).toBeCloseTo(500);
    // Expected latency ≈ cache + miss fraction × db.
    const cacheLatency = a.nodes.cache!.latencyMs;
    expect(a.avgLatencyMs).toBeCloseTo(cacheLatency + 0.2 * a.nodes.d!.latencyMs);
    expect(a.maxThroughput).toBeCloseTo(5000); // db capacity / miss fraction
  });

  it('latency grows sharply near saturation', () => {
    const graph = g([['c', 'client'], ['s', 'service', { capacityPerInstance: 100, latencyMs: 10 }]], [['c', 's']]);
    const low = analyze(graph, 10).avgLatencyMs;
    const high = analyze(graph, 95).avgLatencyMs;
    expect(low).toBeLessThan(12);
    expect(high).toBeGreaterThan(low * 5);
  });

  it('resolves autoscaled instances for steady load', () => {
    const graph = g(
      [
        ['c', 'client'],
        [
          's',
          'service',
          {
            capacityPerInstance: 100,
            autoscale: { enabled: true, minInstances: 1, maxInstances: 5, targetUtilization: 0.5, provisionSec: 0, cooldownSec: 0 },
          },
        ],
      ],
      [['c', 's']],
    );
    expect(analyze(graph, 100).nodes.s!.instances).toBe(2);
    expect(analyze(graph, 10).nodes.s!.instances).toBe(1);
    expect(analyze(graph, 10000).nodes.s!.instances).toBe(5);
  });

  it('splits traffic across multiple clients by share', () => {
    const graph = g(
      [
        ['c1', 'client', { trafficShare: 3 }],
        ['c2', 'client', { trafficShare: 1 }],
        ['s', 'service'],
      ],
      [
        ['c1', 's'],
        ['c2', 's'],
      ],
    );
    const a = analyze(graph, 400);
    expect(a.nodes.c1!.arrival).toBeCloseTo(300);
    expect(a.nodes.c2!.arrival).toBeCloseTo(100);
    expect(a.nodes.s!.arrival).toBeCloseTo(400);
  });

  it('saturated queue drops the excess at its drain rate', () => {
    const graph = g(
      [
        ['c', 'client'],
        ['q', 'queue', { capacityPerInstance: 100, queueMaxDepth: 1000 }],
        ['d', 'database', { capacityPerInstance: 1000 }],
      ],
      [
        ['c', 'q'],
        ['q', 'd'],
      ],
    );
    const a = analyze(graph, 150);
    expect(a.nodes.q!.dropped).toBeCloseTo(50);
    expect(a.nodes.d!.arrival).toBeCloseTo(100);
    expect(a.nodes.q!.latencyMs).toBeGreaterThan(10_000 - 1);
  });
});

describe('validation', () => {
  it('rejects cycles, missing clients and bad edges', () => {
    const cyc = g(
      [
        ['c', 'client'],
        ['a', 'service'],
        ['b', 'service'],
      ],
      [
        ['c', 'a'],
        ['a', 'b'],
        ['b', 'a'],
      ],
    );
    expect(validateGraph(cyc).some((i) => i.severity === 'error' && /cycle/.test(i.message))).toBe(true);
    expect(() => analyze(cyc, 10)).toThrow(GraphError);

    const noClient = g([['a', 'service']], []);
    expect(validateGraph(noClient).some((i) => /Clients/.test(i.message))).toBe(true);

    const toClient = g([['c', 'client'], ['d', 'client']], [['c', 'd']]);
    expect(validateGraph(toClient).some((i) => /cannot receive/.test(i.message))).toBe(true);

    const dangling = g([['c', 'client']], [['c', 'missing']]);
    expect(validateGraph(dangling).some((i) => /missing node/.test(i.message))).toBe(true);
  });

  it('warns about unreachable nodes', () => {
    const graph = g([['c', 'client'], ['s', 'service'], ['orphan', 'service']], [['c', 's']]);
    const issues = validateGraph(graph);
    expect(issues.find((i) => i.nodeId === 'orphan')?.severity).toBe('warning');
  });

  it('rejects invalid parameters', () => {
    const graph = g([['c', 'client'], ['s', 'service', { hitRate: 2 }]], [['c', 's']]);
    expect(validateGraph(graph).some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('traffic profiles', () => {
  it('evaluates each profile type', () => {
    expect(profileRate({ type: 'constant', rps: 50 }, 1000, 3600)).toBe(50);
    const daily = { type: 'daily', baseRps: 100, peakRps: 500, peakHour: 12 } as const;
    expect(profileRate(daily, 12 * 3600, 86400)).toBeCloseTo(500);
    expect(profileRate(daily, 0, 86400)).toBeCloseTo(100);
    const spike = { type: 'spike', baseRps: 10, spikeRps: 110, startSec: 100, durationSec: 200, rampSec: 50 } as const;
    expect(profileRate(spike, 50, 1000)).toBe(10);
    expect(profileRate(spike, 125, 1000)).toBeCloseTo(60);
    expect(profileRate(spike, 200, 1000)).toBeCloseTo(110);
    expect(profileRate(spike, 400, 1000)).toBe(10);
    expect(profileRate({ type: 'ramp', startRps: 0, endRps: 100 }, 500, 1000)).toBeCloseTo(50);
    const custom: TrafficProfile = { type: 'custom', points: [{ t: 0, rps: 0 }, { t: 100, rps: 100 }] };
    expect(profileRate(custom, 25, 100)).toBeCloseTo(25);
    expect(profileRate(custom, 500, 100)).toBe(100);
  });

  it('computes peak and parses custom points', () => {
    expect(peakRate(scenario({ profile: { type: 'ramp', startRps: 0, endRps: 80 } }))).toBeCloseTo(80);
    expect(parseCustomPoints('0, 10\n60 20\n')).toEqual([
      { t: 0, rps: 10 },
      { t: 60, rps: 20 },
    ]);
    expect(parseCustomPoints('abc')).toBeNull();
    expect(parseCustomPoints('')).toBeNull();
  });
});

describe('simulate (time-stepped)', () => {
  const simple = g(
    [
      ['c', 'client'],
      ['s', 'service', { instances: 1, capacityPerInstance: 100 }],
    ],
    [['c', 's']],
  );

  it('is deterministic for a seed and varies with noise', () => {
    const sc = scenario({ noise: 0.2, seed: 5 });
    const a = simulate(simple, sc);
    const b = simulate(simple, sc);
    expect(Array.from(a.offered)).toEqual(Array.from(b.offered));
    const c = simulate(simple, { ...sc, seed: 6 });
    expect(Array.from(c.offered)).not.toEqual(Array.from(a.offered));
    expect(Math.min(...a.offered)).toBeLessThan(Math.max(...a.offered));
  });

  it('conserves requests: offered = completed + dropped + backlog change', () => {
    const graph = g(
      [
        ['c', 'client'],
        ['q', 'queue', { capacityPerInstance: 50, queueMaxDepth: 2000 }],
        ['d', 'database', { capacityPerInstance: 40 }],
      ],
      [
        ['c', 'q'],
        ['q', 'd'],
      ],
    );
    const sc = scenario({ profile: { type: 'ramp', startRps: 10, endRps: 120 }, noise: 0.1 });
    const r = simulate(graph, sc);
    let offered = 0;
    let completed = 0;
    let dropped = 0;
    for (let i = 0; i < r.steps; i++) {
      offered += r.offered[i]! * 10;
      completed += r.completed[i]! * 10;
      dropped += r.dropped[i]! * 10;
    }
    const backlog = r.nodes.q!.backlog[r.steps - 1]!;
    expect(offered).toBeCloseTo(completed + dropped + backlog, 3);
  });

  it('queue absorbs a burst and drains afterwards', () => {
    const graph = g(
      [
        ['c', 'client'],
        ['q', 'queue', { capacityPerInstance: 100, queueMaxDepth: 1e6 }],
        ['d', 'database', { capacityPerInstance: 1000 }],
      ],
      [
        ['c', 'q'],
        ['q', 'd'],
      ],
    );
    const sc = scenario({
      profile: { type: 'spike', baseRps: 50, spikeRps: 200, startSec: 100, durationSec: 100, rampSec: 0 },
      durationSec: 1000,
    });
    const r = simulate(graph, sc);
    const backlog = r.nodes.q!.backlog;
    const peak = Math.max(...backlog);
    expect(peak).toBeGreaterThan(5000);
    expect(r.summary.droppedRequests).toBeCloseTo(0);
    expect(backlog[r.steps - 1]).toBeCloseTo(0);
    expect(r.summary.peakBacklog).toBeCloseTo(peak);
  });

  it('queue drops once its buffer is full', () => {
    const graph = g(
      [
        ['c', 'client'],
        ['q', 'queue', { capacityPerInstance: 10, queueMaxDepth: 100 }],
      ],
      [['c', 'q']],
    );
    const r = simulate(graph, scenario({ profile: { type: 'constant', rps: 50 } }));
    expect(r.summary.droppedRequests).toBeGreaterThan(0);
    expect(Math.max(...r.nodes.q!.backlog)).toBeLessThanOrEqual(100);
  });

  it('cache hit rate warms up over time', () => {
    const graph = g(
      [
        ['c', 'client'],
        ['cache', 'cache', { hitRate: 0.9, warmupSec: 300 }],
        ['d', 'database', { capacityPerInstance: 1e6 }],
      ],
      [
        ['c', 'cache'],
        ['cache', 'd'],
      ],
    );
    const r = simulate(graph, scenario());
    const hr = r.nodes.cache!.hitRate;
    expect(hr[0]).toBe(0);
    expect(hr[15]).toBeCloseTo(0.45);
    expect(hr[40]).toBeCloseTo(0.9);
    expect(r.nodes.d!.arrival[0]).toBeGreaterThan(r.nodes.d!.arrival[40]!);
  });

  it('autoscaling lags behind a spike, then catches up and scales in', () => {
    const graph = g(
      [
        ['c', 'client'],
        [
          's',
          'service',
          {
            instances: 1,
            capacityPerInstance: 100,
            autoscale: { enabled: true, minInstances: 1, maxInstances: 10, targetUtilization: 0.5, provisionSec: 60, cooldownSec: 120 },
          },
        ],
      ],
      [['c', 's']],
    );
    const sc = scenario({
      profile: { type: 'spike', baseRps: 40, spikeRps: 400, startSec: 100, durationSec: 400, rampSec: 0 },
      durationSec: 1500,
    });
    const r = simulate(graph, sc);
    const s = r.nodes.s!;
    // Immediately after the spike starts there is a shortfall.
    expect(s.dropped[10]).toBeGreaterThan(0);
    expect(s.instances[10]).toBe(1);
    // The autoscaler reacts one step later; pending capacity is billed but not yet serving.
    expect(s.pendingInstances[11]).toBeGreaterThan(0);
    expect(s.instances[11]).toBe(1);
    expect(s.costPerHour[11]).toBeCloseTo((s.instances[11]! + s.pendingInstances[11]!) * 0.1);
    // Instances arrive after the provisioning delay and the shortfall clears.
    expect(s.instances[15]).toBe(1);
    expect(s.instances[18]).toBe(8);
    expect(s.dropped[18]).toBeCloseTo(0);
    // Scales back in after the spike + cooldown.
    expect(s.instances[r.steps - 1]).toBe(1);
    expect(r.summary.droppedRequests).toBeGreaterThan(0);
    expect(r.summary.secondsOverCapacity).toBeGreaterThan(0);
  });

  it('reports cost and capacity summary', () => {
    const graph = g(
      [
        ['c', 'client'],
        ['s', 'service', { instances: 2, capacityPerInstance: 100, costPerInstanceHour: 1 }],
      ],
      [['c', 's']],
    );
    const sc = scenario({ profile: { type: 'constant', rps: 100 }, durationSec: 3600, stepSec: 60 });
    const sum = simulate(graph, sc).summary;
    expect(sum.totalCost).toBeCloseTo(2);
    expect(sum.avgCostPerHour).toBeCloseTo(2);
    expect(sum.capacityAtPeak).toBeCloseTo(200);
    expect(sum.peakHeadroom).toBeCloseTo(2);
    expect(sum.capacityEfficiency).toBeCloseTo(0.5);
    expect(sum.dropRate).toBe(0);
    expect(sum.totalRequests).toBeCloseTo(100 * 3600);
    expect(sum.costPerMillionRequests).toBeCloseTo((2 / (100 * 3600)) * 1e6);
  });

  it('exposes per-step node metrics and validates the scenario', () => {
    const r = simulate(simple, scenario());
    const m = nodeMetricsAt(r, 's', 3)!;
    expect(m.arrival).toBeCloseTo(100);
    expect(m.served).toBeCloseTo(100);
    expect(nodeMetricsAt(r, 'nope', 0)).toBeUndefined();
    expect(() => simulate(simple, scenario({ stepSec: 0 }))).toThrow(GraphError);
    expect(() => simulate(simple, scenario({ durationSec: 1e7, stepSec: 1 }))).toThrow(/Too many steps/);
  });

  it('runs every preset with sane results', () => {
    for (const p of PRESETS) {
      expect(validateGraph(p.graph).filter((i) => i.severity === 'error')).toEqual([]);
      const r = simulate(p.graph, p.scenario);
      expect(r.summary.totalCost).toBeGreaterThan(0);
      expect(r.summary.totalRequests).toBeGreaterThan(0);
      expect(r.summary.dropRate).toBeGreaterThanOrEqual(0);
      expect(r.summary.dropRate).toBeLessThan(1);
    }
    const flash = PRESETS.find((p) => p.id === 'flash-sale')!;
    expect(simulate(flash.graph, flash.scenario).summary.droppedRequests).toBeGreaterThan(0);
    const queue = PRESETS.find((p) => p.id === 'queue-buffer')!;
    const qr = simulate(queue.graph, queue.scenario);
    expect(qr.summary.dropRate).toBeLessThan(0.001);
    expect(qr.summary.peakBacklog).toBeGreaterThan(1000);
  });
});
