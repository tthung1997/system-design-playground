import { describe, expect, it } from 'vitest';
import { graphOf } from '../model/builder.ts';
import type { Graph } from '../model/types.ts';
import { CHALLENGES, getChallenge } from './definitions.ts';
import { evaluateChallenge } from './judge.ts';
import { REFERENCES } from './references.ts';
import type { ChallengeDef } from './types.ts';

const stars = (id: string, key: string) => {
  const def = getChallenge(id)!;
  const g = (REFERENCES as Record<string, Record<string, Graph>>)[id]![key]!;
  return evaluateChallenge(def, g);
};

describe('reference solutions', () => {
  for (const [id, expected] of [
    ['read-heavy-api', { three: 3, threeAlt: 3, two: 2, one: 1, fail: 0 }],
    ['highly-available-api', { three: 3, two: 2, one: 1, fail: 0 }],
    ['bursty-notifications', { three: 3, two: 2, one: 1, fail: 0 }],
  ] as const) {
    for (const [key, n] of Object.entries(expected)) {
      it(`${id}: ${key} earns ${n} stars`, () => {
        const e = stars(id, key);
        expect(e.valid).toBe(true);
        expect(e.stars).toBe(n);
        if (n === 0) expect(e.feedback.length).toBeGreaterThan(0);
      });
    }
  }

  it('every challenge starts empty and invalid, and has an attainable third star', () => {
    for (const c of CHALLENGES) {
      const e = evaluateChallenge(c, c.starter);
      expect(e.valid).toBe(false);
      expect(e.stars).toBe(0);
      expect(e.score).toBe(0);
      expect(stars(c.id, 'three').stars).toBe(3);
    }
  });
});

describe('structural rules', () => {
  const def = getChallenge('read-heavy-api')!;
  it('requires a service on every path to the database', () => {
    const g = graphOf([['c', 'client', 'U'], ['d', 'database', 'D']], [['c', 'd']]);
    const e = evaluateChallenge(def, g);
    expect(e.valid).toBe(false);
    expect(e.errors.join(' ')).toMatch(/service/);
    expect(e.stars).toBe(0);
  });

  it('rejects a service path that can be bypassed', () => {
    const g = graphOf(
      [['c', 'client', 'U'], ['lb', 'loadBalancer', 'LB'], ['s', 'service', 'S'], ['d', 'database', 'D']],
      [['c', 'lb'], ['lb', 's'], ['lb', 'd'], ['s', 'd']],
    );
    const e = evaluateChallenge(def, g);
    expect(e.valid).toBe(false);
  });

  it('enforces the component limit', () => {
    const g = structuredClone(REFERENCES['read-heavy-api'].three);
    for (let i = 0; i < 20; i++) g.nodes.push({ ...g.nodes[1]!, id: `extra-${i}`, name: `Extra ${i}` });
    const e = evaluateChallenge(def, g);
    expect(e.valid).toBe(false);
    expect(e.errors.join(' ')).toMatch(/at most/);
  });

  it('decorative disconnected components still cost money and cannot boost a score', () => {
    const base = evaluateChallenge(def, REFERENCES['read-heavy-api'].three);
    const g = structuredClone(REFERENCES['read-heavy-api'].three);
    g.nodes.push({ ...g.nodes.find((n) => n.id === 'db')!, id: 'decoy', name: 'Decoy', config: { size: 'large', replicas: 3 } });
    const padded = evaluateChallenge(def, g);
    expect(padded.summary.costUsd).toBeGreaterThan(base.summary.costUsd);
    expect(padded.stars).toBeLessThan(base.stars);
    expect(padded.score).toBeLessThan(base.score);
  });

  it('is deterministic and independent of component order', () => {
    const g = REFERENCES['highly-available-api'].three;
    const shuffled = { nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
    const failDef = getChallenge('highly-available-api')!;
    expect(evaluateChallenge(failDef, shuffled)).toEqual(evaluateChallenge(failDef, g));
  });
});

describe('thresholds', () => {
  const g = graphOf([['c', 'client', 'U'], ['s', 'service', 'S'], ['d', 'database', 'D']], [['c', 's'], ['s', 'd']]);
  const mini = (tiers: [number, number, number], better: 'lower' | 'higher' = 'lower', metric: 'costUsd' | 'servedPct' = 'costUsd'): ChallengeDef => ({
    id: 'mini', version: 1, title: 'mini', difficulty: 'Starter', summary: '', story: [], requirements: [],
    scenarios: [{ id: 's', label: 'S', workload: { rps: 100, readRatio: 1, durationSec: 10 } }],
    criteria: [{ id: 'k', label: 'K', category: 'cost', metric, scenarioId: 's', better, tiers, best: better === 'lower' ? 100 : 100, worst: better === 'lower' ? 1000 : 0, weight: 1, unit: '', hint: 'h' }],
    primaryScenarioId: 's', requiredOnEveryPath: ['service'], maxComponents: 5, starter: g,
  });

  it('treats thresholds as inclusive and adjacent failing values as failures (cost = 390)', () => {
    expect(evaluateChallenge(mini([389, 389, 389]), g).stars).toBe(0);
    expect(evaluateChallenge(mini([390, 389, 389]), g).stars).toBe(1);
    expect(evaluateChallenge(mini([391, 390, 389]), g).stars).toBe(2);
    expect(evaluateChallenge(mini([392, 391, 390]), g).stars).toBe(3);
    expect(evaluateChallenge(mini([392, 391, 389]), g).stars).toBe(2);
  });

  it('handles higher-is-better criteria and unavailable values', () => {
    expect(evaluateChallenge(mini([100, 100, 100], 'higher', 'servedPct'), g).stars).toBe(3);
    const overloaded = { ...g, nodes: g.nodes.map((n) => (n.id === 's' ? { ...n, config: { size: 'small' as const } } : n)) };
    const heavy = mini([100, 100, 100], 'higher', 'servedPct');
    heavy.scenarios[0]!.workload.rps = 5000;
    expect(evaluateChallenge(heavy, overloaded).stars).toBe(0);
  });

  it('scores monotonically with respect to each metric and ignores other submissions', () => {
    const def = getChallenge('read-heavy-api')!;
    const cheap = evaluateChallenge(def, REFERENCES['read-heavy-api'].three);
    const dear = structuredClone(REFERENCES['read-heavy-api'].three);
    dear.nodes.find((n) => n.id === 'db')!.config = { size: 'large' };
    const dearEval = evaluateChallenge(def, dear);
    expect(dearEval.summary.costUsd).toBeGreaterThan(cheap.summary.costUsd);
    expect(dearEval.score).toBeLessThan(cheap.score + 0.0001);
    expect(evaluateChallenge(def, dear).score).toBe(dearEval.score);
  });

  it('every tier threshold set is monotonic', () => {
    for (const c of CHALLENGES) {
      for (const k of c.criteria) {
        const [a, b, d] = k.tiers;
        if (k.better === 'lower') expect(a >= b && b >= d).toBe(true);
        else expect(a <= b && b <= d).toBe(true);
      }
    }
  });
});
