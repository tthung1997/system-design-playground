// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChallenge } from '../challenges/definitions.ts';
import { evaluateChallenge } from '../challenges/judge.ts';
import { REFERENCES } from '../challenges/references.ts';
import { emptyLearningData, mergeLearningData, parseLearningData, serializeLearningData } from '../learning/data.ts';
import { graphOf } from '../model/builder.ts';
import { DEFAULT_WORKLOAD } from '../model/defaults.ts';
import { parseDocument, serializeDocument } from '../model/document.ts';
import { PRESETS } from '../model/presets.ts';
import { loadLearning, saveLearning } from './learningStorage.ts';
import { useLearning } from './learningStore.ts';
import { loadSavedDocument } from './storage.ts';
import { useStore } from './useStore.ts';
import { flushPending, loadWorkspace, PLAYGROUND, scheduleSave } from './workspaces.ts';

const store = () => useStore.getState();
const learning = () => useLearning.getState();

const seedA = { graph: graphOf([['c', 'client', 'A users'], ['s', 'service', 'A api'], ['d', 'database', 'A db']], [['c', 's'], ['s', 'd']]), workload: { rps: 111, readRatio: 0.5, durationSec: 5 } };
const seedB = { graph: graphOf([['c', 'client', 'B users']], []), workload: DEFAULT_WORKLOAD };

beforeEach(() => {
  localStorage.clear();
  useLearning.setState({ data: emptyLearningData(), warnings: [], saveError: null });
  useStore.setState({
    graph: PRESETS[0]!.graph,
    workload: DEFAULT_WORKLOAD,
    past: [],
    future: [],
    selectedNodeIds: [],
    selectedEdgeIds: [],
    notice: null,
    workspace: PLAYGROUND,
  });
});

describe('numeric edits', () => {
  it('records workload and configuration changes in undo/redo', () => {
    store().setWorkload({ rps: 5000 });
    store().updateConfig('api', { replicas: 4, size: 'large' });
    expect(store().workload.rps).toBe(5000);
    expect(store().graph.nodes.find((n) => n.id === 'api')!.config).toEqual({ replicas: 4, size: 'large' });
    store().undo();
    expect(store().graph.nodes.find((n) => n.id === 'api')!.config).toBeUndefined();
    store().undo();
    expect(store().workload.rps).toBe(DEFAULT_WORKLOAD.rps);
    store().redo();
    store().redo();
    expect(store().workload.rps).toBe(5000);
    expect(store().graph.nodes.find((n) => n.id === 'api')!.config?.replicas).toBe(4);
  });

  it('coalesces rapid edits of one field and rejects invalid values with a notice', () => {
    store().setWorkload({ rps: 10 });
    store().setWorkload({ rps: 100 });
    store().setWorkload({ rps: 1000 });
    expect(store().past).toHaveLength(1);
    expect(store().setWorkload({ readRatio: 2 })).toBe(false);
    expect(store().notice).toMatch(/Read ratio/);
    expect(store().updateConfig('api', { replicas: 0 })).toBe(false);
    expect(store().updateConfig('api', { replicas: 1.5 })).toBe(false);
    expect(store().updateConfig('clients', { replicas: 2 })).toBe(false);
    expect(store().updateConfig('db', { size: 'huge' as never })).toBe(false);
  });

  it('clearing a setting returns the component to its documented default', () => {
    store().updateConfig('api', { replicas: 3 });
    store().updateConfig('api', { replicas: undefined });
    expect(store().graph.nodes.find((n) => n.id === 'api')!.config).toBeUndefined();
  });

  it('round-trips through JSON together with the workload', () => {
    store().updateConfig('db', { replicas: 3, size: 'small' });
    store().setWorkload({ rps: 777, readRatio: 0.25, durationSec: 12 });
    const text = serializeDocument({ graph: store().graph, workload: store().workload });
    const parsed = parseDocument(text);
    expect(parsed.ok && parsed.doc.graph).toEqual(store().graph);
    expect(parsed.ok && parsed.doc.workload).toEqual({ rps: 777, readRatio: 0.25, durationSec: 12 });
  });

  it('keeps legacy files valid and ignores simulation fields they never had', () => {
    const v2 = { version: 2, graph: { nodes: [{ id: 'a', kind: 'service', config: { replicas: 99 } }], edges: [] } };
    const r = parseDocument(v2);
    expect(r.ok && r.doc.graph.nodes[0]!.config).toBeUndefined();
    const v3 = { version: 3, graph: { nodes: [{ id: 'a', kind: 'service', config: { replicas: 99 } }], edges: [] } };
    expect(parseDocument(v3)).toMatchObject({ ok: false, error: expect.stringContaining('replicas') });
    expect(parseDocument({ version: 3, graph: { nodes: [{ id: 'a', kind: 'client', config: { size: 'large' } }], edges: [] } }).ok).toBe(false);
    expect(parseDocument({ version: 3, graph: { nodes: [] }, workload: { rps: -1, readRatio: 0.5, durationSec: 5 } }).ok).toBe(false);
  });
});

describe('workspace isolation', () => {
  it('keeps playground, lesson and challenge diagrams separate, with fresh history and selection', () => {
    store().addNode('cache', { x: 0, y: 0 });
    const playgroundNodes = store().graph.nodes.length;
    store().setSelection(['cache-1'], []);

    store().switchWorkspace('lesson:a', seedA);
    expect(store().workspace).toBe('lesson:a');
    expect(store().graph).toBe(seedA.graph);
    expect(store().workload).toEqual(seedA.workload);
    expect(store().past).toHaveLength(0);
    expect(store().selectedNodeIds).toEqual([]);
    store().updateNode('s', { name: 'Edited API' });
    store().undo();
    store().redo();

    store().switchWorkspace('challenge:b', seedB);
    expect(store().graph.nodes.map((n) => n.name)).toEqual(['B users']);
    expect(store().past).toHaveLength(0);
    store().undo();
    expect(store().graph.nodes.map((n) => n.name)).toEqual(['B users']);

    store().switchWorkspace('lesson:a', seedA);
    expect(store().graph.nodes.find((n) => n.id === 's')!.name).toBe('Edited API');
    expect(store().past).toHaveLength(0);

    store().switchWorkspace(PLAYGROUND, seedB);
    expect(store().graph.nodes).toHaveLength(playgroundNodes);
    expect(store().graph.nodes.some((n) => n.id === 'cache-1')).toBe(true);
  });

  it('never autosaves lesson or challenge edits over the playground document', () => {
    store().switchWorkspace('lesson:a', seedA);
    store().updateNode('s', { name: 'Lesson edit' });
    scheduleSave(store().workspace, { graph: store().graph, workload: store().workload });
    flushPending();
    expect(loadSavedDocument()!.graph).toEqual(PRESETS[0]!.graph);
    expect(learning().data.drafts['lesson:a']!.graph.nodes.find((n) => n.id === 's')!.name).toBe('Lesson edit');
    scheduleSave(PLAYGROUND, { graph: PRESETS[1]!.graph, workload: DEFAULT_WORKLOAD });
    flushPending();
    expect(loadSavedDocument()!.graph).toEqual(PRESETS[1]!.graph);
    expect(learning().data.drafts['lesson:a']!.graph.nodes.find((n) => n.id === 's')!.name).toBe('Lesson edit');
  });

  it('flushes a pending save when switching so no change is lost', () => {
    store().switchWorkspace('lesson:a', seedA);
    store().updateNode('s', { name: 'Unsaved edit' });
    scheduleSave('lesson:a', { graph: store().graph, workload: store().workload }, 60_000);
    store().switchWorkspace('challenge:b', seedB);
    expect(loadWorkspace('lesson:a')!.graph.nodes.find((n) => n.id === 's')!.name).toBe('Unsaved edit');
  });

  it('recovers saved drafts after a reload', () => {
    store().switchWorkspace('lesson:a', seedA);
    store().updateConfig('s', { replicas: 6 });
    scheduleSave('lesson:a', { graph: store().graph, workload: store().workload });
    flushPending();
    const reloaded = loadLearning();
    expect(reloaded.warnings).toEqual([]);
    expect(reloaded.data.drafts['lesson:a']!.graph.nodes.find((n) => n.id === 's')!.config?.replicas).toBe(6);
  });

  it('resetting a lesson clears its draft and answers but keeps its completion', () => {
    learning().recordAnswer('a', 'q1', 42);
    learning().completeLesson('a');
    learning().saveDraft('lesson:a', seedA);
    learning().resetLesson('a');
    expect(learning().data.drafts['lesson:a']).toBeUndefined();
    expect(learning().data.lessons.a!.answers).toEqual({});
    expect(learning().data.lessons.a!.completedAt).toBeTruthy();
  });
});

describe('learning data storage', () => {
  it('keeps unreadable data under a backup key and reports it', () => {
    localStorage.setItem('system-design-playground:learning', '{not json');
    const r = loadLearning();
    expect(r.data).toEqual(emptyLearningData());
    expect(r.warnings[0]).toMatch(/could not be read/);
    expect(localStorage.getItem('system-design-playground:learning:corrupt-backup')).toBe('{not json');
  });

  it('skips invalid entries but loads everything else', () => {
    const good = evaluateChallenge(getChallenge('read-heavy-api')!, REFERENCES['read-heavy-api'].three);
    const raw = {
      version: 1,
      lessons: { ok: { answers: { s: 1 }, completedAt: '2026-01-01T00:00:00Z' }, bad: 5 },
      drafts: { 'lesson:ok': { graph: seedA.graph, workload: seedA.workload }, 'lesson:bad': { graph: { nodes: 'x' } } },
      submissions: [
        { id: 's1', challengeId: 'read-heavy-api', challengeVersion: 1, simVersion: 1, judgeVersion: 1, createdAt: '2026-01-01T00:00:00Z', graph: REFERENCES['read-heavy-api'].three, evaluation: good },
        { id: 's2', challengeId: 'x' },
      ],
    };
    const parsed = parseLearningData(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.value.data.lessons)).toEqual(['ok']);
    expect(Object.keys(parsed.value.data.drafts)).toEqual(['lesson:ok']);
    expect(parsed.value.data.submissions.map((s) => s.id)).toEqual(['s1']);
    expect(parsed.value.warnings).toHaveLength(3);
    expect(parseLearningData({ version: 9 })).toMatchObject({ ok: false });
    expect(parseLearningData('nope')).toMatchObject({ ok: false });
  });

  it('reports quota and unavailable-storage failures instead of hiding them', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(saveLearning(emptyLearningData())).toMatch(/Could not save/);
    learning().recordAnswer('a', 'q', 1);
    expect(learning().saveError).toMatch(/Could not save/);
    expect(learning().data.lessons.a!.answers.q).toBe(1);
    spy.mockRestore();
    learning().recordAnswer('a', 'q', 2);
    expect(learning().saveError).toBeNull();
  });

  it('exports and imports a backup, merging without duplicating submissions', () => {
    const def = getChallenge('read-heavy-api')!;
    const evalTop = evaluateChallenge(def, REFERENCES['read-heavy-api'].three);
    const sub = learning().addSubmission(REFERENCES['read-heavy-api'].three, evalTop);
    learning().completeLesson('scaling');
    const backup = serializeLearningData(learning().data);

    useLearning.setState({ data: emptyLearningData() });
    expect(learning().importBackup(backup)).toMatchObject({ ok: true });
    expect(learning().data.submissions.map((s) => s.id)).toEqual([sub.id]);
    expect(learning().data.lessons.scaling!.completedAt).toBeTruthy();
    learning().importBackup(backup);
    expect(learning().data.submissions).toHaveLength(1);
    expect(learning().importBackup('garbage')).toMatchObject({ ok: false });

    const merged = mergeLearningData(emptyLearningData(), learning().data);
    expect(merged.submissions).toHaveLength(1);
  });
});

describe('submissions', () => {
  it('are immutable snapshots that later edits cannot change', () => {
    const def = getChallenge('read-heavy-api')!;
    const graph = structuredClone(REFERENCES['read-heavy-api'].three);
    const evaluation = evaluateChallenge(def, graph);
    const sub = learning().addSubmission(graph, evaluation);
    graph.nodes[1]!.name = 'tampered';
    expect(sub.graph.nodes[1]!.name).not.toBe('tampered');
    expect(Object.isFrozen(sub)).toBe(true);
    expect(() => {
      (sub.graph.nodes[0] as { name: string }).name = 'x';
    }).toThrow();
    expect(sub.evaluation.stars).toBe(3);
    expect(sub.createdAt).toMatch(/^\d{4}-/);
    expect(learning().data.submissions).toHaveLength(1);
    expect(sub.challengeVersion).toBe(def.version);
  });
});
