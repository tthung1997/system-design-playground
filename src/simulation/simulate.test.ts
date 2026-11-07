import { describe, expect, it } from 'vitest';
import { graphOf } from '../model/builder.ts';
import type { Graph, Workload } from '../model/types.ts';
import { monthlyCost } from './catalog.ts';
import { simulate, totalMonthlyCost, validateTopology } from './simulate.ts';

const W = (rps: number, readRatio = 1, durationSec = 60): Workload => ({ rps, readRatio, durationSec });
const simple = (service = {}, db = {}): Graph =>
  graphOf(
    [
      ['c', 'client', 'Users'],
      ['s', 'service', 'API', service],
      ['d', 'database', 'DB', db],
    ],
    [['c', 's'], ['s', 'd']],
  );

describe('validation', () => {
  it('requires one client, no dead ends, no fan-out, no cycles', () => {
    expect(validateTopology(graphOf([['s', 'service', 'S']], [])).map((i) => i.message)[0]).toMatch(/Clients/);
    const dead = graphOf([['c', 'client', 'C'], ['s', 'service', 'S']], [['c', 's']]);
    expect(validateTopology(dead).some((i) => /dead end/.test(i.message))).toBe(true);
    const fan = graphOf(
      [['c', 'client', 'C'], ['s', 'service', 'S'], ['a', 'database', 'A'], ['b', 'database', 'B']],
      [['c', 's'], ['s', 'a'], ['s', 'b']],
    );
    expect(validateTopology(fan).some((i) => /split traffic/.test(i.message))).toBe(true);
    const cyc = graphOf(
      [['c', 'client', 'C'], ['a', 'service', 'A'], ['b', 'service', 'B']],
      [['c', 'a'], ['a', 'b'], ['b', 'a']],
    );
    expect(validateTopology(cyc).some((i) => /cycle/.test(i.message))).toBe(true);
    const two = graphOf([['c', 'client', 'C'], ['c2', 'client', 'C2']], []);
    expect(validateTopology(two).some((i) => /single Clients/.test(i.message))).toBe(true);
  });

  it('rejects invalid configuration and workloads without returning metrics', () => {
    const bad = simple({ replicas: 0 });
    const r = simulate(bad, W(10));
    expect(r.ok).toBe(false);
    expect(r.servedRatio).toBeNull();
    expect(simulate(simple(), W(-1)).ok).toBe(false);
    expect(simulate(simple(), { rps: 10, readRatio: 2, durationSec: 5 }).ok).toBe(false);
  });

  it('flags databases that forward traffic and unreachable components as costing money', () => {
    const g = graphOf(
      [['c', 'client', 'C'], ['s', 'service', 'S'], ['d', 'database', 'D'], ['x', 'cache', 'X']],
      [['c', 's'], ['s', 'd']],
    );
    const issues = validateTopology(g);
    expect(issues.find((i) => i.nodeId === 'x')?.severity).toBe('warning');
    expect(simulate(g, W(10)).monthlyCostUsd).toBe(130 + 260 + 90);
  });
});

describe('capacity, saturation and latency', () => {
  it('serves everything below capacity with documented latency', () => {
    const r = simulate(simple(), W(500));
    expect(r.ok).toBe(true);
    expect(r.servedRatio).toBeCloseTo(1);
    expect(r.nodes.s!.utilization).toBeCloseTo(0.5);
    // service 20ms / (1-0.5) + db read 8ms / (1-0.25)
    expect(r.meanLatencyMs).toBeCloseTo(40 + 8 / 0.75);
    expect(r.tailLatencyMs).toBeCloseTo(40 + 8 / 0.75);
  });

  it('drops the excess when saturated and reports the bottleneck', () => {
    const r = simulate(simple(), W(2000));
    expect(r.nodes.s!.saturated).toBe(true);
    expect(r.servedRatio).toBeCloseTo(0.5);
    expect(r.bottleneckId).toBe('s');
    expect(r.nodes.s!.servedRps).toBeCloseTo(1000);
  });

  it('adds capacity with replicas and charges for them', () => {
    const r = simulate(simple({ replicas: 2 }), W(1800));
    expect(r.servedRatio).toBeCloseTo(1);
    expect(r.monthlyCostUsd).toBe(260 + 260);
  });

  it('limits writes to the database primary regardless of read replicas', () => {
    const g = simple({ replicas: 10 }, { replicas: 5 });
    const r = simulate(g, W(1000, 0));
    expect(r.nodes.d!.utilization).toBeCloseTo(2);
    expect(r.servedRatio).toBeCloseTo(0.5);
    expect(simulate(g, W(1000, 1)).servedRatio).toBeCloseTo(1);
  });

  it('makes latency grow with utilization', () => {
    const low = simulate(simple(), W(100)).meanLatencyMs!;
    const high = simulate(simple(), W(900)).meanLatencyMs!;
    expect(high).toBeGreaterThan(low * 2);
  });
});

describe('routing', () => {
  const balanced = graphOf(
    [
      ['c', 'client', 'C'],
      ['lb', 'loadBalancer', 'LB'],
      ['a', 'service', 'A'],
      ['b', 'service', 'B'],
      ['d', 'database', 'D', { size: 'large' }],
    ],
    [['c', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'd'], ['b', 'd']],
    { a: [2, 0], b: [2, 1] },
  );

  it('splits evenly at a load balancer and sums flows at a join without duplicating traffic', () => {
    const r = simulate(balanced, W(1600));
    expect(r.nodes.a!.arrivalRps).toBeCloseTo(800);
    expect(r.nodes.b!.arrivalRps).toBeCloseTo(800);
    expect(r.nodes.d!.arrivalRps).toBeCloseTo(1600);
    expect(r.edges.e2).toBeCloseTo(800);
  });

  it('is independent of node and connection order', () => {
    const shuffled: Graph = { nodes: [...balanced.nodes].reverse(), edges: [...balanced.edges].reverse() };
    expect(simulate(shuffled, W(1700, 0.7))).toEqual(simulate(balanced, W(1700, 0.7)));
  });

  it('reads hit the cache without reaching the database, misses and writes pass through', () => {
    const g = graphOf(
      [['c', 'client', 'C'], ['s', 'service', 'S', { size: 'large' }], ['k', 'cache', 'K'], ['d', 'database', 'D']],
      [['c', 's'], ['s', 'k'], ['k', 'd']],
    );
    const r = simulate(g, W(1000, 0.9));
    expect(r.nodes.k!.arrivalRps).toBeCloseTo(1000);
    expect(r.nodes.d!.arrivalRps).toBeCloseTo(900 * 0.2 + 100);
    expect(r.tailLatencyMs!).toBeGreaterThan(r.meanLatencyMs!);
  });

  it('a CDN serves part of the reads at the edge', () => {
    const g = graphOf(
      [['c', 'client', 'C'], ['n', 'cdn', 'CDN'], ['s', 'service', 'S'], ['d', 'database', 'D']],
      [['c', 'n'], ['n', 's'], ['s', 'd']],
    );
    const r = simulate(g, W(1000, 1));
    expect(r.nodes.s!.arrivalRps).toBeCloseTo(400);
  });
});

describe('failure and availability', () => {
  it('a single replica failure takes down a non-redundant path', () => {
    const r = simulate(simple(), W(200), { failure: 'worst-single-replica' });
    expect(r.failure?.servedRatio).toBe(0);
    expect(r.failure?.tailLatencyMs).toBeNull();
  });

  it('redundancy survives the failure only with enough spare capacity', () => {
    const tight = simulate(simple({ replicas: 2 }, { replicas: 2 }), W(1800), { failure: 'worst-single-replica' });
    expect(tight.failure!.servedRatio!).toBeLessThan(1);
    const spare = simulate(simple({ replicas: 3 }, { replicas: 2 }), W(1800), { failure: 'worst-single-replica' });
    expect(spare.failure!.servedRatio).toBeCloseTo(1);
  });

  it('a load balancer without replicas is a single point of failure', () => {
    const g = graphOf(
      [['c', 'client', 'C'], ['lb', 'loadBalancer', 'LB'], ['s', 'service', 'S', { replicas: 3 }], ['d', 'database', 'D', { replicas: 2 }]],
      [['c', 'lb'], ['lb', 's'], ['s', 'd']],
    );
    const r = simulate(g, W(500), { failure: 'worst-single-replica' });
    expect(r.failure?.nodeId).toBe('lb');
    expect(r.failure?.servedRatio).toBe(0);
  });

  it('derives availability from replica counts and needed capacity, not just node count', () => {
    const single = simulate(simple(), W(500)).availability!;
    const redundant = simulate(simple({ replicas: 2 }, { replicas: 2 }), W(500)).availability!;
    expect(single).toBeCloseTo(0.995 * 0.995);
    expect(redundant).toBeGreaterThan(single);
    // 3 replicas that are all required are less available than one replica that is enough
    const allNeeded = simulate(simple({ replicas: 3 }), W(2900)).availability!;
    const oneNeeded = simulate(simple({ replicas: 1 }), W(900)).availability!;
    expect(allNeeded).toBeLessThan(oneNeeded);
    // overloaded designs are unavailable
    expect(simulate(simple(), W(5000)).availability).toBe(0);
  });
});

describe('queues', () => {
  const queued = (queue = {}, worker = {}, db = {}): Graph =>
    graphOf(
      [
        ['c', 'client', 'C'],
        ['api', 'service', 'API', { replicas: 2 }],
        ['q', 'queue', 'Queue', queue],
        ['w', 'service', 'Worker', worker],
        ['d', 'database', 'DB', db],
      ],
      [['c', 'api'], ['api', 'q'], ['q', 'w'], ['w', 'd']],
    );

  it('acknowledges at the queue and drains the burst afterwards', () => {
    const r = simulate(queued(), W(1500, 0, 60));
    expect(r.servedRatio).toBeCloseTo(1);
    // db primary writes 500/s: backlog = (1500 - 500) * 60
    expect(r.queue!.drainRps).toBeCloseTo(500);
    expect(r.queue!.maxBacklog).toBeCloseTo(60000);
    expect(r.queue!.drainSeconds).toBeCloseTo(120);
    expect(r.queue!.lostMessages).toBe(0);
    // synchronous latency stops at the queue acknowledgement
    expect(r.tailLatencyMs!).toBeCloseTo(20 / 0.25 + 5 / 0.7);
  });

  it('loses messages beyond the backlog limit and counts them as failures', () => {
    const r = simulate(queued(), W(1900, 0, 600));
    expect(r.queue!.lostMessages).toBeGreaterThan(0);
    expect(r.servedRatio!).toBeLessThan(1);
  });

  it('a cheap terminal queue does not count as a working design', () => {
    const g = graphOf([['c', 'client', 'C'], ['q', 'queue', 'Q']], [['c', 'q']]);
    expect(simulate(g, W(10, 0)).ok).toBe(false);
  });

  it('rejects reads reaching a queue and shared consumers', () => {
    const r = simulate(queued(), W(100, 0.5));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /read traffic/.test(i.message))).toBe(true);
    const shared = graphOf(
      [['c', 'client', 'C'], ['lb', 'loadBalancer', 'LB'], ['q', 'queue', 'Q'], ['w', 'service', 'W'], ['d', 'database', 'D']],
      [['c', 'lb'], ['lb', 'q'], ['lb', 'w'], ['q', 'w'], ['w', 'd']],
    );
    expect(validateTopology(shared).some((i) => /both queued and direct/.test(i.message))).toBe(true);
  });

  it('a consumer failure stops the drain', () => {
    const r = simulate(queued(), W(400, 0, 10), { failure: 'worst-single-replica' });
    expect(r.failure!.queue!.drainSeconds).toBeNull();
    expect(r.failure!.queue!.maxBacklog).toBeCloseTo(4000);
  });
});

describe('cost', () => {
  it('counts every provisioned component, even disconnected ones', () => {
    const g = simple();
    g.nodes.push({ ...g.nodes[1]!, id: 'extra', name: 'Extra', config: { replicas: 3, size: 'large' } });
    expect(totalMonthlyCost(g)).toBe(130 + 260 + 900);
    expect(monthlyCost(g.nodes[3]!)).toBe(900);
  });
});
