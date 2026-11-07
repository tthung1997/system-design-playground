import { describe, expect, it } from 'vitest';
import { getChallenge } from './definitions.ts';
import { evaluateChallenge } from './judge.ts';
import { bestStars, isCurrent, rankSubmissions } from './rankings.ts';
import { REFERENCES } from './references.ts';
import type { Submission } from '../learning/data.ts';

const def = getChallenge('read-heavy-api')!;
const baseEval = evaluateChallenge(def, REFERENCES['read-heavy-api'].three);

function sub(id: string, patch: { stars?: 0 | 1 | 2 | 3; score?: number; cost?: number; latency?: number | null; avail?: number | null; at?: string; version?: number; sim?: number }): Submission {
  return {
    id,
    challengeId: def.id,
    challengeVersion: patch.version ?? def.version,
    simVersion: patch.sim ?? baseEval.simVersion,
    judgeVersion: baseEval.judgeVersion,
    createdAt: patch.at ?? '2026-01-01T00:00:00.000Z',
    graph: REFERENCES['read-heavy-api'].three,
    evaluation: {
      ...baseEval,
      stars: patch.stars ?? 3,
      score: patch.score ?? 80,
      summary: {
        costUsd: patch.cost ?? 1500,
        latencyMs: patch.latency === undefined ? 100 : patch.latency,
        availabilityPct: patch.avail === undefined ? 99.9 : patch.avail,
        failureServedPct: null,
      },
    },
  };
}

describe('rankings', () => {
  it('orders overall by stars, then score, then earlier submission; ties share a rank', () => {
    const subs = [
      sub('a', { stars: 2, score: 95 }),
      sub('b', { stars: 3, score: 70 }),
      sub('c', { stars: 3, score: 80, at: '2026-02-01T00:00:00.000Z' }),
      sub('d', { stars: 3, score: 80, at: '2026-01-01T00:00:00.000Z' }),
    ];
    const { ranked } = rankSubmissions(subs, def, 'overall');
    expect(ranked.map((r) => r.submission.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
  });

  it('ranks each metric view in its own direction and drops unavailable values', () => {
    const subs = [
      sub('cheap', { cost: 1000, latency: 150, avail: 99.0 }),
      sub('fast', { cost: 1800, latency: 60, avail: 99.5 }),
      sub('solid', { cost: 1600, latency: 90, avail: 99.99 }),
      sub('nolat', { cost: 900, latency: null, avail: 99.2 }),
    ];
    const ids = (view: 'cost' | 'latency' | 'reliability') => rankSubmissions(subs, def, view).ranked.map((r) => r.submission.id);
    expect(ids('cost')).toEqual(['nolat', 'cheap', 'solid', 'fast']);
    expect(ids('latency')).toEqual(['fast', 'solid', 'cheap']);
    expect(ids('reliability')).toEqual(['solid', 'fast', 'nolat', 'cheap']);
  });

  it('treats a legitimate zero distinctly from unavailable', () => {
    const subs = [sub('zero', { latency: 0 }), sub('none', { latency: null }), sub('slow', { latency: 10 })];
    expect(rankSubmissions(subs, def, 'latency').ranked.map((r) => r.submission.id)).toEqual(['zero', 'slow']);
  });

  it('keeps failed and outdated attempts in history, out of the rankings', () => {
    const subs = [
      sub('ok', { stars: 1 }),
      sub('zero', { stars: 0, at: '2026-03-01T00:00:00.000Z' }),
      sub('old', { stars: 3, version: 0 }),
      sub('oldsim', { stars: 3, sim: 0 }),
      { ...sub('other', {}), challengeId: 'highly-available-api' },
    ];
    const { ranked, history } = rankSubmissions(subs, def, 'overall');
    expect(ranked.map((r) => r.submission.id)).toEqual(['ok']);
    expect(history.map((h) => [h.submission.id, h.reason])).toEqual([
      ['zero', 'no-stars'],
      ['oldsim', 'outdated'],
      ['old', 'outdated'],
    ]);
    expect(isCurrent(subs[2]!, def)).toBe(false);
    expect(bestStars(subs, def)).toBe(1);
  });

  it('is deterministic for identical timestamps', () => {
    const subs = [sub('b', {}), sub('a', {})];
    expect(rankSubmissions(subs, def, 'overall').ranked.map((r) => r.submission.id)).toEqual(['a', 'b']);
    expect(rankSubmissions([...subs].reverse(), def, 'overall').ranked.map((r) => r.submission.id)).toEqual(['a', 'b']);
  });
});
