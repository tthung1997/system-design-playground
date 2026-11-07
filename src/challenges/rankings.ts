import type { Submission } from '../learning/data.ts';
import { SIM_VERSION } from '../simulation/catalog.ts';
import { JUDGE_VERSION } from './types.ts';
import type { ChallengeDef } from './types.ts';

export type RankView = 'overall' | 'cost' | 'latency' | 'reliability';

export const RANK_VIEWS: { id: RankView; label: string; unit: string; hint: string }[] = [
  { id: 'overall', label: 'Overall', unit: 'score', hint: 'Stars first, then weighted score.' },
  { id: 'cost', label: 'Cost', unit: 'USD / month', hint: 'Lowest estimated monthly cost.' },
  { id: 'latency', label: 'Latency', unit: 'ms', hint: 'Lowest worst-path latency in the primary scenario.' },
  { id: 'reliability', label: 'Reliability', unit: '%', hint: 'Highest modeled availability, then failure-scenario served rate.' },
];

/** Submissions are only comparable when challenge, simulator and judge versions all match. */
export function isCurrent(sub: Submission, def: ChallengeDef): boolean {
  return sub.challengeId === def.id && sub.challengeVersion === def.version && sub.simVersion === SIM_VERSION && sub.judgeVersion === JUDGE_VERSION;
}

export interface RankedEntry {
  rank: number;
  submission: Submission;
  /** The metric this view ranks on, when it has one. */
  value: number | null;
}

type Key = number[];

const overallKey = (s: Submission): Key => [-s.evaluation.stars, -s.evaluation.score];

function viewKey(view: RankView, s: Submission): Key | null {
  const e = s.evaluation;
  switch (view) {
    case 'overall':
      return overallKey(s);
    case 'cost':
      return [e.summary.costUsd, ...overallKey(s)];
    case 'latency':
      return e.summary.latencyMs === null ? null : [e.summary.latencyMs, ...overallKey(s)];
    case 'reliability':
      return e.summary.availabilityPct === null ? null : [-e.summary.availabilityPct, -(e.summary.failureServedPct ?? -1), ...overallKey(s)];
  }
}

const primary = (view: RankView, s: Submission): number | null => {
  const e = s.evaluation;
  switch (view) {
    case 'overall':
      return e.score;
    case 'cost':
      return e.summary.costUsd;
    case 'latency':
      return e.summary.latencyMs;
    case 'reliability':
      return e.summary.availabilityPct;
  }
};

const compare = (a: Key, b: Key) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
};

/** How many keys count towards a tie in each view (the metric itself, not its tie-breakers). */
const TIE_KEYS: Record<RankView, number> = { overall: 2, cost: 1, latency: 1, reliability: 2 };

export interface Rankings {
  ranked: RankedEntry[];
  /** Everything else, newest first: failed attempts and results from older versions. */
  history: { submission: Submission; reason: 'no-stars' | 'outdated' }[];
}

/**
 * Ranks passing submissions of the current challenge version. Ties on the ranked metric share a
 * rank; ordering among them is deterministic (earlier submission first, then id).
 */
export function rankSubmissions(subs: Submission[], def: ChallengeDef, view: RankView): Rankings {
  const mine = subs.filter((s) => s.challengeId === def.id);
  const eligible: { s: Submission; key: Key }[] = [];
  const history: Rankings['history'] = [];
  for (const s of mine) {
    if (!isCurrent(s, def)) history.push({ submission: s, reason: 'outdated' });
    else if (s.evaluation.stars === 0) history.push({ submission: s, reason: 'no-stars' });
    else {
      const key = viewKey(view, s);
      if (key) eligible.push({ s, key });
    }
  }
  eligible.sort((a, b) => compare(a.key, b.key) || a.s.createdAt.localeCompare(b.s.createdAt) || a.s.id.localeCompare(b.s.id));
  const ranked: RankedEntry[] = [];
  eligible.forEach((e, i) => {
    const prev = eligible[i - 1];
    const tied = prev && compare(prev.key.slice(0, TIE_KEYS[view]), e.key.slice(0, TIE_KEYS[view])) === 0;
    ranked.push({ rank: tied ? ranked[i - 1]!.rank : i + 1, submission: e.s, value: primary(view, e.s) });
  });
  history.sort((a, b) => b.submission.createdAt.localeCompare(a.submission.createdAt) || b.submission.id.localeCompare(a.submission.id));
  return { ranked, history };
}

/** Best passing result for the current version (used for catalog badges); 0 when none. */
export function bestStars(subs: Submission[], def: ChallengeDef): 0 | 1 | 2 | 3 {
  let best: 0 | 1 | 2 | 3 = 0;
  for (const s of subs) if (isCurrent(s, def) && s.evaluation.stars > best) best = s.evaluation.stars;
  return best;
}
