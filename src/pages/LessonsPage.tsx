import { useEffect, useState } from 'react';
import { routeHref } from '../app/route.ts';
import { getLesson, LESSONS, answerCorrect } from '../content/lessons.ts';
import type { Lesson, LessonContext, LessonStep } from '../content/lessons.ts';
import { useLearning } from '../store/learningStore.ts';
import type { SimResult } from '../simulation/simulate.ts';
import { useStore } from '../store/useStore.ts';
import { Properties } from '../ui/Properties.tsx';
import { overlayOf, ResultsCard, useSimulation, WorkloadCard } from '../ui/SimulationPanel.tsx';
import { EditorLayout, WorkspaceGate } from '../ui/Workspace.tsx';

export function LessonsPage() {
  const progress = useLearning((s) => s.data.lessons);
  const done = LESSONS.filter((l) => progress[l.id]?.completedAt).length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-8">
        <h2 className="m-0 text-2xl font-bold tracking-tight">Lessons</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">
          Short, hands-on lessons on core system design ideas. Each one starts from a diagram you can change; the simulation shows what your change does. Everything is open: the suggested order is only a guide.
        </p>
        <p className="text-[13px] text-muted" aria-live="polite">
          {done} of {LESSONS.length} completed
        </p>
        <ol className="m-0 mt-5 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {LESSONS.map((l, i) => {
            const completed = !!progress[l.id]?.completedAt;
            return (
              <li key={l.id} className="card flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                  <span>Lesson {i + 1}</span>
                  {completed && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent normal-case">Completed</span>}
                </div>
                <h3 className="m-0 text-base font-semibold">{l.title}</h3>
                <p className="m-0 text-[13px] leading-relaxed text-muted">{l.summary}</p>
                {l.prerequisites.length > 0 && (
                  <p className="m-0 text-xs text-muted">Suggested first: {l.prerequisites.map((p) => getLesson(p)?.title ?? p).join(', ')}</p>
                )}
                <a className="btn btn-primary mt-auto no-underline" href={routeHref({ page: 'lessons', id: l.id })}>
                  {completed ? 'Review lesson' : 'Start lesson'}
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function NumberStep({ lessonId, step, index }: { lessonId: string; step: Extract<LessonStep, { kind: 'number' }>; index: number }) {
  const saved = useLearning((s) => s.data.lessons[lessonId]?.answers[step.id]);
  const recordAnswer = useLearning((s) => s.recordAnswer);
  const [draft, setDraft] = useState(saved === undefined ? '' : String(saved));
  useEffect(() => {
    setDraft(saved === undefined ? '' : String(saved));
  }, [saved]);
  const submitted = saved !== undefined;
  const correct = submitted && answerCorrect(step, saved);
  const value = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(value);
  const id = `${lessonId}-${step.id}`;
  return (
    <li className="rounded-lg border border-line bg-app p-3">
      <StepHeader index={index} ok={correct} text={step.prompt} />
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) recordAnswer(lessonId, step.id, value);
        }}
      >
        <label htmlFor={id} className="sr-only">
          Your answer in {step.unit}
        </label>
        <input id={id} className="input w-32 font-mono" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={submitted && !correct && draft === String(saved)} />
        <span className="text-xs text-muted">{step.unit}</span>
        <button type="submit" className="btn ml-auto" disabled={!valid}>
          Check
        </button>
      </form>
      {correct && <p className="mt-2 mb-0 text-xs leading-relaxed text-muted">{step.explanation}</p>}
      {submitted && !correct && draft === String(saved) && (
        <p className="mt-2 mb-0 text-xs text-danger" role="status">
          Not quite. Re-read the lesson and try again.
        </p>
      )}
    </li>
  );
}

function StepHeader({ index, ok, text }: { index: number; ok: boolean; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${ok ? 'border-accent bg-accent text-app' : 'border-line text-muted'}`}
        aria-hidden
      >
        {ok ? '✓' : index + 1}
      </span>
      <p className="m-0 text-[13px] leading-relaxed">
        <span className="sr-only">{ok ? 'Done. ' : 'To do. '}</span>
        {text}
      </p>
    </div>
  );
}

function GraphStep({ step, ctx, index }: { step: Extract<LessonStep, { kind: 'graph' }>; ctx: LessonContext; index: number }) {
  const outcome = step.check(ctx);
  return (
    <li className="rounded-lg border border-line bg-app p-3">
      <StepHeader index={index} ok={outcome.ok} text={step.prompt} />
      <p className="mt-2 mb-0 font-mono text-xs text-muted" aria-live="polite">
        {outcome.detail}
      </p>
      {!outcome.ok && <p className="mt-1 mb-0 text-xs text-muted">Hint: {step.hint}</p>}
    </li>
  );
}

function LessonPanel({ lesson, result }: { lesson: Lesson; result: SimResult }) {
  const graph = useStore((s) => s.graph);
  const workload = useStore((s) => s.workload);
  const loadDocument = useStore((s) => s.loadDocument);
  const setNotice = useStore((s) => s.setNotice);
  const progress = useLearning((s) => s.data.lessons[lesson.id]);
  const completeLesson = useLearning((s) => s.completeLesson);
  const resetLesson = useLearning((s) => s.resetLesson);
  const [confirmReset, setConfirmReset] = useState(false);

  const ctx: LessonContext = { graph, workload, sim: result };
  const statuses = lesson.steps.map((s) =>
    s.kind === 'number' ? progress?.answers[s.id] !== undefined && answerCorrect(s, progress.answers[s.id]!) : s.check(ctx).ok,
  );
  const allDone = statuses.every(Boolean);

  useEffect(() => {
    if (allDone) completeLesson(lesson.id);
  }, [allDone, completeLesson, lesson.id]);

  return (
    <>
      <section className="card">
        <h2 className="m-0 text-base font-semibold">{lesson.title}</h2>
        <p className="mt-1 mb-2 text-[13px] text-muted">{lesson.summary}</p>
        <ul className="m-0 list-disc space-y-0.5 pl-4 text-xs text-muted">
          {lesson.goals.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </section>

      <details className="card" open>
        <summary className="card-title cursor-pointer">Read</summary>
        {lesson.sections.map((s) => (
          <div key={s.heading}>
            <h3 className="mt-3 mb-1 text-[13px] font-semibold">{s.heading}</h3>
            {s.body.map((p, i) => (
              <p key={i} className="my-1.5 text-[13px] leading-relaxed text-muted">
                {p}
              </p>
            ))}
          </div>
        ))}
      </details>

      <section className="card" aria-label="Activity">
        <h2 className="card-title">
          Activity <span className="ml-auto font-mono normal-case">{statuses.filter(Boolean).length}/{statuses.length}</span>
        </h2>
        <ol className="m-0 list-none space-y-2.5 p-0">
          {lesson.steps.map((s, i) =>
            s.kind === 'number' ? (
              <NumberStep key={s.id} lessonId={lesson.id} step={s} index={i} />
            ) : (
              <GraphStep key={s.id} step={s} ctx={ctx} index={i} />
            ),
          )}
        </ol>
        {allDone && (
          <p className="mt-3 mb-0 rounded-lg bg-accent/15 px-3 py-2 text-[13px] font-semibold text-accent" role="status">
            Lesson complete. Keep experimenting or move on.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {confirmReset ? (
            <>
              <span className="text-xs text-muted">Reset the diagram, workload and answers?</span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  resetLesson(lesson.id);
                  loadDocument({ graph: lesson.starter.graph, workload: lesson.starter.workload });
                  setConfirmReset(false);
                  setNotice('Lesson reset');
                }}
              >
                Yes, reset
              </button>
              <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setConfirmReset(true)}>
              Reset lesson
            </button>
          )}
        </div>
      </section>

      <WorkloadCard />
      <ResultsCard result={result} names={Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]))} />
      <Properties />
    </>
  );
}

function LessonBody({ lesson }: { lesson: Lesson }) {
  const result = useSimulation()!;
  return (
    <EditorLayout wide overlay={overlayOf(result)}>
      <LessonPanel lesson={lesson} result={result} />
    </EditorLayout>
  );
}

export function LessonPage({ id }: { id: string }) {
  const lesson = getLesson(id);
  if (!lesson) {
    return (
      <div className="p-8">
        <p>That lesson does not exist.</p>
        <a href={routeHref({ page: 'lessons' })}>Back to lessons</a>
      </div>
    );
  }
  return (
    <WorkspaceGate key={lesson.id} workspaceKey={`lesson:${lesson.id}`} seed={lesson.starter}>
      <LessonBody lesson={lesson} />
    </WorkspaceGate>
  );
}
