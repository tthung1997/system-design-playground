import { describe, expect, it } from 'vitest';
import { graphOf } from '../model/builder.ts';
import type { Graph, Workload } from '../model/types.ts';
import { simulate } from '../simulation/simulate.ts';
import { answerCorrect, getLesson, hasChain, LESSONS } from './lessons.ts';
import type { LessonContext } from './lessons.ts';

const ctxOf = (graph: Graph, workload: Workload): LessonContext => ({ graph, workload, sim: simulate(graph, workload, { failure: 'worst-single-replica' }) });

const graphSteps = (id: string) => getLesson(id)!.steps.filter((s) => s.kind === 'graph');
const results = (id: string, graph: Graph, workload: Workload) => {
  const ctx = ctxOf(graph, workload);
  return graphSteps(id).map((s) => (s.kind === 'graph' ? s.check(ctx).ok : true));
};

const SOLUTIONS: Record<string, { graph: Graph; workload: Workload }> = {
  estimation: {
    graph: graphOf(
      [['clients', 'client', 'U'], ['api', 'service', 'API', { size: 'medium', replicas: 10 }], ['db', 'database', 'DB', { size: 'large', replicas: 3 }]],
      [['clients', 'api'], ['api', 'db']],
    ),
    workload: { rps: 6944, readRatio: 0.9, durationSec: 60 },
  },
  scaling: {
    graph: graphOf(
      [['clients', 'client', 'U'], ['api', 'service', 'API', { size: 'medium', replicas: 4 }], ['db', 'database', 'DB', { size: 'medium', replicas: 2 }]],
      [['clients', 'api'], ['api', 'db']],
    ),
    workload: { rps: 3000, readRatio: 0.9, durationSec: 60 },
  },
  'load-balancing': {
    graph: graphOf(
      [['clients', 'client', 'U'], ['lb', 'loadBalancer', 'LB', { replicas: 2 }], ['api', 'service', 'API', { size: 'medium', replicas: 3 }], ['db', 'database', 'DB', { size: 'large', replicas: 2 }]],
      [['clients', 'lb'], ['lb', 'api'], ['api', 'db']],
    ),
    workload: { rps: 2000, readRatio: 0.9, durationSec: 60 },
  },
  caching: {
    graph: graphOf(
      [['clients', 'client', 'U'], ['lb', 'loadBalancer', 'LB', { replicas: 2 }], ['api', 'service', 'API', { size: 'medium', replicas: 8 }], ['cache', 'cache', 'Cache', { size: 'medium' }], ['db', 'database', 'DB', { size: 'medium' }]],
      [['clients', 'lb'], ['lb', 'api'], ['api', 'cache'], ['cache', 'db']],
    ),
    workload: { rps: 6000, readRatio: 0.95, durationSec: 60 },
  },
  replication: {
    graph: graphOf(
      [['clients', 'client', 'U'], ['lb', 'loadBalancer', 'LB', { replicas: 2 }], ['api', 'service', 'API', { size: 'medium', replicas: 3 }], ['db', 'database', 'DB', { size: 'small', replicas: 4 }]],
      [['clients', 'lb'], ['lb', 'api'], ['api', 'db']],
    ),
    workload: { rps: 1800, readRatio: 0.9, durationSec: 60 },
  },
  queues: {
    graph: graphOf(
      [['clients', 'client', 'P'], ['api', 'service', 'API', { size: 'medium', replicas: 3 }], ['q', 'queue', 'Q', { size: 'small' }], ['w', 'service', 'Worker', { size: 'medium', replicas: 2 }], ['db', 'database', 'DB', { size: 'large' }]],
      [['clients', 'api'], ['api', 'q'], ['q', 'w'], ['w', 'db']],
    ),
    workload: { rps: 2500, readRatio: 0, durationSec: 30 },
  },
};

describe('lesson content', () => {
  it('has six lessons with unique ids and valid prerequisites', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['estimation', 'scaling', 'load-balancing', 'caching', 'replication', 'queues']);
    const ids = new Set(LESSONS.map((l) => l.id));
    for (const l of LESSONS) {
      for (const p of l.prerequisites) expect(ids.has(p)).toBe(true);
      expect(new Set(l.steps.map((s) => s.id)).size).toBe(l.steps.length);
      expect(l.steps.length).toBeGreaterThan(0);
    }
  });

  for (const lesson of LESSONS) {
    it(`${lesson.id}: starter diagram simulates but does not complete the activity`, () => {
      const ctx = ctxOf(lesson.starter.graph, lesson.starter.workload);
      expect(ctx.sim.ok).toBe(true);
      const outcomes = results(lesson.id, lesson.starter.graph, lesson.starter.workload);
      expect(outcomes.some((ok) => !ok)).toBe(true);
    });

    it(`${lesson.id}: a correct solution passes every graph step`, () => {
      const s = SOLUTIONS[lesson.id]!;
      expect(results(lesson.id, s.graph, s.workload)).toEqual(graphSteps(lesson.id).map(() => true));
    });

    it(`${lesson.id}: number answers accept the expected value and reject others`, () => {
      for (const step of lesson.steps) {
        if (step.kind !== 'number') continue;
        expect(answerCorrect(step, step.expected)).toBe(true);
        expect(answerCorrect(step, step.expected * 1.5 + 1)).toBe(false);
        expect(answerCorrect(step, 0)).toBe(false);
      }
    });
  }

  it('numeric answers agree with the simulator', () => {
    const caching = ctxOf(SOLUTIONS.caching!.graph, SOLUTIONS.caching!.workload);
    expect(caching.sim.nodes.db!.arrivalRps).toBeCloseTo(5700 * 0.2 + 300);
    const q = ctxOf(
      graphOf(
        [['c', 'client', 'P'], ['a', 'service', 'A', { replicas: 3 }], ['q', 'queue', 'Q'], ['w', 'service', 'W', { replicas: 2 }], ['d', 'database', 'D', { size: 'medium' }]],
        [['c', 'a'], ['a', 'q'], ['q', 'w'], ['w', 'd']],
      ),
      { rps: 1500, readRatio: 0, durationSec: 30 },
    );
    expect(q.sim.queue!.maxBacklog).toBeCloseTo(30000);
  });

  it('hasChain matches ordered kinds only along connections', () => {
    const g = SOLUTIONS.caching!.graph;
    expect(hasChain(g, ['service', 'cache', 'database'])).toBe(true);
    expect(hasChain(g, ['database', 'cache'])).toBe(false);
  });
});
