import { useMemo, useState } from 'react';
import { routeHref } from '../app/route.ts';
import { CHALLENGES, getChallenge } from '../challenges/definitions.ts';
import { evaluateChallenge } from '../challenges/judge.ts';
import { bestStars, isCurrent, RANK_VIEWS, rankSubmissions } from '../challenges/rankings.ts';
import type { RankView } from '../challenges/rankings.ts';
import type { ChallengeDef, Evaluation } from '../challenges/types.ts';
import type { Submission } from '../learning/data.ts';
import { DEFAULT_WORKLOAD } from '../model/defaults.ts';
import { simulate } from '../simulation/simulate.ts';
import { useLearning } from '../store/learningStore.ts';
import { useStore } from '../store/useStore.ts';
import { fmtMs, fmtPct, fmtSeconds, fmtUsd } from '../ui/format.ts';
import { Properties } from '../ui/Properties.tsx';
import { Stars } from '../ui/Stars.tsx';
import { EditorLayout, WorkspaceGate } from '../ui/Workspace.tsx';
import { AlertIcon } from '../ui/icons.tsx';
import type { Overlay } from '../ui/Editor.tsx';

export function ChallengesPage() {
  const subs = useLearning((s) => s.data.submissions);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-8">
        <h2 className="m-0 text-2xl font-bold tracking-tight">Challenges</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Design a system for each brief using the simulator. Your design is judged on cost, reliability and latency under published scenarios. Meet the requirements for one star; stricter published targets earn two and three.
        </p>
        <ul className="m-0 mt-5 grid list-none gap-4 p-0 md:grid-cols-2 lg:grid-cols-3">
          {CHALLENGES.map((c) => {
            const mine = subs.filter((s) => s.challengeId === c.id);
            return (
              <li key={c.id} className="card flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                  <span>{c.difficulty}</span>
                  <Stars count={bestStars(subs, c)} />
                </div>
                <h3 className="m-0 text-base font-semibold">{c.title}</h3>
                <p className="m-0 text-[13px] leading-relaxed text-muted">{c.summary}</p>
                <p className="m-0 text-xs text-muted">{mine.length === 0 ? 'No submissions yet' : `${mine.length} submission${mine.length === 1 ? '' : 's'}`}</p>
                <a className="btn btn-primary mt-auto no-underline" href={routeHref({ page: 'challenges', id: c.id })}>
                  {mine.length === 0 ? 'Start challenge' : 'Continue'}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const formatValue = (metric: string, v: number | null) => {
  if (v === null) return 'n/a';
  switch (metric) {
    case 'costUsd':
      return fmtUsd(v);
    case 'tailLatencyMs':
    case 'meanLatencyMs':
      return fmtMs(v);
    case 'drainSeconds':
      return fmtSeconds(v);
    case 'servedPct':
    case 'availabilityPct':
      return fmtPct(v, 3);
    default:
      return v.toLocaleString();
  }
};

function CriteriaTable({ evaluation }: { evaluation: Evaluation }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">Criteria, your value and the targets for each star</caption>
        <thead>
          <tr className="text-[10px] tracking-[0.1em] text-muted uppercase">
            <th scope="col" className="py-1 pr-2 font-semibold">Criterion</th>
            <th scope="col" className="px-1 py-1 text-right font-semibold">You</th>
            {[1, 2, 3].map((n) => (
              <th key={n} scope="col" className="px-1 py-1 text-right font-semibold">
                {n}★
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {evaluation.criteria.map((c) => (
            <tr key={c.id} className="border-t border-line align-top">
              <th scope="row" className="py-1.5 pr-2 font-medium">
                {c.label}
                <span className="block text-[10px] font-normal text-muted">{c.better === 'lower' ? 'at most' : 'at least'}</span>
              </th>
              <td className={`px-1 py-1.5 text-right font-mono ${c.passed[0] ? '' : 'text-danger'}`}>{formatValue(c.metric, c.value)}</td>
              {c.targets.map((t, i) => (
                <td key={i} className="px-1 py-1.5 text-right font-mono whitespace-nowrap">
                  <span className={c.passed[i] ? 'text-accent' : 'text-muted'}>
                    {formatValue(c.metric, t)}
                    <span className="sr-only">{c.passed[i] ? ' (met)' : ' (not met)'}</span>
                    <span aria-hidden> {c.passed[i] ? '✓' : '·'}</span>
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Brief({ def }: { def: ChallengeDef }) {
  return (
    <>
      <section className="card">
        <div className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{def.difficulty}</div>
        <h2 className="m-0 mt-1 text-base font-semibold">{def.title}</h2>
        {def.story.map((p, i) => (
          <p key={i} className="my-2 text-[13px] leading-relaxed text-muted">
            {p}
          </p>
        ))}
      </section>
      <section className="card">
        <h3 className="card-title">Requirements</h3>
        <ul className="m-0 list-disc space-y-1 pl-4 text-[13px] leading-relaxed">
          {def.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h3 className="card-title">Scenarios</h3>
        <ul className="m-0 list-none space-y-1.5 p-0 text-[13px]">
          {def.scenarios.map((s) => (
            <li key={s.id}>
              <strong>{s.label}</strong>: {s.workload.rps.toLocaleString()} rps, {Math.round(s.workload.readRatio * 100)}% reads, {s.workload.durationSec} s
              {s.failure ? ', with the most damaging single replica failing' : ''}
            </li>
          ))}
        </ul>
        <p className="hint">
          Judged by a deterministic model of capacity, latency, availability and cost. It checks only what the simulator can represent: not consistency, security or application correctness.
        </p>
      </section>
    </>
  );
}

function Results({ def, evaluation, scenarioId, onScenario, onSubmit }: { def: ChallengeDef; evaluation: Evaluation; scenarioId: string; onScenario: (id: string) => void; onSubmit: () => void }) {
  return (
    <>
      <section className="card" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="card-title mb-1">Current design</h3>
            <div className="flex items-center gap-2">
              <Stars count={evaluation.stars} size={22} />
              <span className="font-mono text-[15px] font-semibold">{evaluation.score.toFixed(1)}</span>
              <span className="text-xs text-muted">score</span>
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={onSubmit}>
            Submit
          </button>
        </div>
        <p className="hint mb-0">
          {evaluation.stars === 0 ? 'Not passing yet: every 1-star requirement must be met.' : `Meets the ${evaluation.stars}-star targets.`} Submitting saves an immutable snapshot of this design.
        </p>
      </section>

      {evaluation.errors.length > 0 && (
        <section className="card">
          <h3 className="card-title">Fix first</h3>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {evaluation.errors.map((e) => (
              <li key={e} className="warn">
                <AlertIcon size={14} className="mt-px shrink-0" />
                {e}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h3 className="card-title">Criteria</h3>
        <CriteriaTable evaluation={evaluation} />
      </section>

      {evaluation.feedback.length > 0 && evaluation.valid && (
        <section className="card">
          <h3 className="card-title">Feedback</h3>
          <ul className="m-0 list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed">
            {evaluation.feedback.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h3 className="card-title">Scenarios</h3>
        <label htmlFor="scenario" className="text-xs text-muted">
          Show on canvas
        </label>
        <select id="scenario" className="input mt-1 w-full" value={scenarioId} onChange={(e) => onScenario(e.target.value)}>
          {def.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <ul className="m-0 mt-3 list-none space-y-2 p-0 text-xs">
          {evaluation.scenarios.map((s) => (
            <li key={s.id} className="rounded-lg border border-line bg-app p-2">
              <strong className="text-[13px]">{s.label}</strong>
              {s.failedComponent && <span className="text-muted"> · worst case: {s.failedComponent} loses a replica</span>}
              <div className="mt-1 font-mono text-muted">
                served {fmtPct(s.servedPct, 2)} · worst path {fmtMs(s.tailLatencyMs)} · availability {fmtPct(s.availabilityPct, 3)}
                {s.lostMessages > 0 || s.drainSeconds !== 0 ? ` · lost ${s.lostMessages.toLocaleString()} · drain ${fmtSeconds(s.drainSeconds)}` : ''}
              </div>
              {s.bottleneck && <div className="text-muted">Tightest component: {s.bottleneck}</div>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function SubmissionRow({ sub, def, rank, value, view, reason, onRestore }: { sub: Submission; def: ChallengeDef; rank?: number; value?: number | null; view: RankView; reason?: 'no-stars' | 'outdated'; onRestore: (s: Submission) => void }) {
  const e = sub.evaluation;
  const unit = RANK_VIEWS.find((v) => v.id === view)!.unit;
  const shown = value === undefined ? null : view === 'cost' ? fmtUsd(value) : view === 'latency' ? fmtMs(value) : view === 'reliability' ? fmtPct(value, 3) : value === null ? 'n/a' : value.toFixed(1);
  return (
    <li className="rounded-lg border border-line bg-app p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {rank !== undefined && <span className="w-6 font-mono text-[15px] font-bold">#{rank}</span>}
        <Stars count={e.stars} size={14} />
        {shown !== null && (
          <span className="font-mono" title={unit}>
            {shown}
          </span>
        )}
        <span className="text-muted">{new Date(sub.createdAt).toLocaleString()}</span>
        {reason && <span className="rounded-full bg-raised px-2 py-0.5 text-muted">{reason === 'outdated' ? 'older version' : 'no stars'}</span>}
        <button type="button" className="btn ml-auto px-2 py-1 text-xs" onClick={() => onRestore(sub)} title="Load this design into the editor (it replaces the current draft; undo to revert)">
          Restore
        </button>
      </div>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-muted">Details</summary>
        <p className="my-1.5 font-mono text-muted">
          score {e.score.toFixed(1)} · {fmtUsd(e.summary.costUsd)}/mo · worst path {fmtMs(e.summary.latencyMs)} · availability {fmtPct(e.summary.availabilityPct, 3)}
          {e.summary.failureServedPct !== null ? ` · after failure ${fmtPct(e.summary.failureServedPct, 2)}` : ''}
        </p>
        {isCurrent(sub, def) ? <CriteriaTable evaluation={e} /> : <p className="m-0 text-muted">Recorded under challenge v{sub.challengeVersion}, simulator v{sub.simVersion}, judge v{sub.judgeVersion}; not comparable with the current rules.</p>}
      </details>
    </li>
  );
}

function Rankings({ def }: { def: ChallengeDef }) {
  const subs = useLearning((s) => s.data.submissions);
  const loadDocument = useStore((s) => s.loadDocument);
  const setNotice = useStore((s) => s.setNotice);
  const [view, setView] = useState<RankView>('overall');
  const { ranked, history } = useMemo(() => rankSubmissions(subs, def, view), [subs, def, view]);
  const restore = (s: Submission) => {
    loadDocument({ graph: structuredClone(s.graph), workload: DEFAULT_WORKLOAD });
    setNotice('Restored submission into the editor');
  };
  const current = RANK_VIEWS.find((v) => v.id === view)!;
  return (
    <>
      <section className="card">
        <h3 className="card-title">Personal rankings</h3>
        <p className="hint mt-0">
          Compares your own passing submissions on this browser. Scores are computed locally, so they are not comparable across people or devices.
        </p>
        <div role="tablist" aria-label="Ranking view" className="flex flex-wrap gap-1.5">
          {RANK_VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={`btn px-2.5 py-1 text-xs ${view === v.id ? 'border-accent text-accent' : ''}`} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <p className="hint">{current.hint} Ties share a rank; the earlier submission is listed first.</p>
        {ranked.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">No passing submissions yet. Reach one star and submit to appear here.</p>
        ) : (
          <ol className="m-0 list-none space-y-2 p-0">
            {ranked.map((r) => (
              <SubmissionRow key={r.submission.id} sub={r.submission} def={def} rank={r.rank} value={r.value} view={view} onRestore={restore} />
            ))}
          </ol>
        )}
      </section>
      <section className="card">
        <h3 className="card-title">History</h3>
        <p className="hint mt-0">Attempts without stars and results from older versions of this challenge. They are kept but never ranked.</p>
        {history.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">Nothing here yet.</p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {history.map((h) => (
              <SubmissionRow key={h.submission.id} sub={h.submission} def={def} view="overall" reason={h.reason} onRestore={restore} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

type Tab = 'brief' | 'results' | 'rankings';

function ChallengeBody({ def }: { def: ChallengeDef }) {
  const graph = useStore((s) => s.graph);
  const setNotice = useStore((s) => s.setNotice);
  const addSubmission = useLearning((s) => s.addSubmission);
  const saveError = useLearning((s) => s.saveError);
  const [tab, setTab] = useState<Tab>('brief');
  const [scenarioId, setScenarioId] = useState(def.primaryScenarioId);
  const evaluation = useMemo(() => evaluateChallenge(def, graph), [def, graph]);
  const scenario = def.scenarios.find((s) => s.id === scenarioId) ?? def.scenarios[0]!;

  const overlay = useMemo<Overlay | null>(() => {
    const sim = simulate(graph, scenario.workload);
    return sim.ok ? { nodes: sim.nodes, edges: sim.edges, bottleneckId: sim.bottleneckId } : null;
  }, [graph, scenario]);

  const submit = () => {
    const sub = addSubmission(graph, evaluation);
    const error = useLearning.getState().saveError;
    setNotice(`Submitted: ${sub.evaluation.stars} star${sub.evaluation.stars === 1 ? '' : 's'}, score ${sub.evaluation.score.toFixed(1)}${error ? `. ${error}` : ''}`);
    setTab('rankings');
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'brief', label: 'Brief' },
    { id: 'results', label: 'Results' },
    { id: 'rankings', label: 'Rankings' },
  ];

  return (
    <EditorLayout wide overlay={overlay}>
      <div role="tablist" aria-label="Challenge panels" className="flex gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`btn flex-1 ${tab === t.id ? 'border-accent text-accent' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'results' && <Stars count={evaluation.stars} size={12} />}
          </button>
        ))}
      </div>
      {saveError && (
        <p className="warn m-0" role="alert">
          <AlertIcon size={14} className="mt-px shrink-0" />
          {saveError}
        </p>
      )}
      {tab === 'brief' && <Brief def={def} />}
      {tab === 'results' && <Results def={def} evaluation={evaluation} scenarioId={scenario.id} onScenario={setScenarioId} onSubmit={submit} />}
      {tab === 'rankings' && <Rankings def={def} />}
      <Properties />
    </EditorLayout>
  );
}

export function ChallengePage({ id }: { id: string }) {
  const def = getChallenge(id);
  if (!def) {
    return (
      <div className="p-8">
        <p>That challenge does not exist.</p>
        <a href={routeHref({ page: 'challenges' })}>Back to challenges</a>
      </div>
    );
  }
  return (
    <WorkspaceGate key={def.id} workspaceKey={`challenge:${def.id}`} seed={{ graph: def.starter, workload: DEFAULT_WORKLOAD }}>
      <ChallengeBody def={def} />
    </WorkspaceGate>
  );
}
