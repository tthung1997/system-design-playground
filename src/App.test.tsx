// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.tsx';
import { REFERENCES } from './challenges/references.ts';
import { emptyLearningData } from './learning/data.ts';
import { DEFAULT_WORKLOAD } from './model/defaults.ts';
import { PRESETS } from './model/presets.ts';
import { useLearning } from './store/learningStore.ts';
import { useStore } from './store/useStore.ts';
import { PLAYGROUND } from './store/workspaces.ts';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1;
    },
  );
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});

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

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const go = async (hash: string) => {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
};

const openApp = async (hash: string) => {
  window.location.hash = hash;
  render(<App />);
  await act(async () => {});
};

describe('navigation', () => {
  it('moves between playground, lessons and challenges and marks the active section', async () => {
    await openApp('#/playground');
    expect(screen.getByRole('link', { name: 'Playground' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Components')).toBeTruthy();

    await go('#/lessons');
    expect(screen.getByRole('heading', { name: 'Lessons' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Start lesson/ })).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Lessons' }).getAttribute('aria-current')).toBe('page');

    await go('#/challenges');
    expect(screen.getByRole('heading', { name: 'Challenges' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Start challenge/ })).toHaveLength(3);
  });

  it('shows a helpful message for unknown lessons and challenges', async () => {
    await openApp('#/lessons/nope');
    expect(screen.getByText(/does not exist/)).toBeTruthy();
    await go('#/challenges/nope');
    expect(screen.getByText(/does not exist/)).toBeTruthy();
  });

  it('leaving a lesson never overwrites the playground diagram', async () => {
    await openApp('#/playground');
    act(() => {
      useStore.getState().addNode('cache', { x: 0, y: 0 });
    });
    const playgroundIds = useStore.getState().graph.nodes.map((n) => n.id);
    await go('#/lessons/scaling');
    expect(useStore.getState().workspace).toBe('lesson:scaling');
    expect(useStore.getState().graph.nodes.map((n) => n.name)).toContain('API');
    act(() => {
      useStore.getState().updateConfig('api', { replicas: 4 });
    });
    await go('#/playground');
    expect(useStore.getState().workspace).toBe(PLAYGROUND);
    expect(useStore.getState().graph.nodes.map((n) => n.id)).toEqual(playgroundIds);
    expect(useStore.getState().past).toHaveLength(0);
  });
});

describe('lessons', () => {
  it('checks numeric answers and explains correct ones', async () => {
    await openApp('#/lessons/estimation');
    const input = screen.getAllByRole('textbox')[0]!;
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Check' })[0]!);
    expect(screen.getByText(/Not quite/)).toBeTruthy();
    fireEvent.change(input, { target: { value: '2315' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Check' })[0]!);
    expect(screen.getByText(/10,000,000 × 20 ÷ 86,400/)).toBeTruthy();
    expect(useLearning.getState().data.lessons.estimation!.answers.avg).toBe(2315);
  });

  it('completes only when the activity is really satisfied, and shows it in the catalog', async () => {
    await openApp('#/lessons/estimation');
    expect(screen.getByText('0/4')).toBeTruthy();
    const inputs = screen.getAllByRole('textbox');
    const checks = screen.getAllByRole('button', { name: 'Check' });
    [['2315', 0], ['6944', 1], ['10', 2]].forEach(([v, i]) => {
      fireEvent.change(inputs[i as number]!, { target: { value: v as string } });
      fireEvent.click(checks[i as number]!);
    });
    expect(screen.getByText('3/4')).toBeTruthy();
    expect(useLearning.getState().data.lessons.estimation?.completedAt).toBeUndefined();

    act(() => {
      useStore.getState().setWorkload({ rps: 6944 });
      useStore.getState().updateConfig('api', { replicas: 10 });
    });
    expect(screen.getByText('4/4')).toBeTruthy();
    expect(screen.getByText(/Lesson complete/)).toBeTruthy();
    expect(useLearning.getState().data.lessons.estimation!.completedAt).toBeTruthy();

    await go('#/lessons');
    expect(screen.getByText('1 of 6 completed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review lesson' })).toBeTruthy();
  });

  it('resets the draft and answers after confirmation but keeps completion', async () => {
    await openApp('#/lessons/queues');
    act(() => {
      useStore.getState().updateConfig('api', { replicas: 9 });
      useLearning.getState().recordAnswer('queues', 'backlog', 30000);
      useLearning.getState().completeLesson('queues');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset lesson' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, reset' }));
    expect(useStore.getState().graph.nodes.find((n) => n.id === 'api')!.config?.replicas).toBe(3);
    expect(useLearning.getState().data.lessons.queues!.answers).toEqual({});
    expect(useLearning.getState().data.lessons.queues!.completedAt).toBeTruthy();
  });
});

describe('challenges', () => {
  it('judges the current design, records submissions, and ranks them', async () => {
    await openApp('#/challenges/read-heavy-api');
    fireEvent.click(screen.getByRole('tab', { name: /Results/ }));
    expect(screen.getByText(/Not passing yet/)).toBeTruthy();
    expect(screen.getByText(/Clients are not connected/)).toBeTruthy();

    // A failing attempt is kept in history.
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByRole('tab', { name: 'Rankings', selected: true })).toBeTruthy();
    expect(screen.getByText(/No passing submissions yet/)).toBeTruthy();
    expect(screen.getByText('no stars')).toBeTruthy();

    act(() => {
      useStore.getState().loadDocument({ graph: REFERENCES['read-heavy-api'].three });
    });
    fireEvent.click(screen.getByRole('tab', { name: /Results/ }));
    expect(screen.getAllByRole('img', { name: '3 of 3 stars' }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Meets the 3-star targets/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(screen.getByText('#1')).toBeTruthy();
    const subs = useLearning.getState().data.submissions;
    expect(subs.map((s) => s.evaluation.stars)).toEqual([0, 3]);

    // A second, cheaper submission ranks first on cost but the first still keeps its place overall.
    act(() => {
      useStore.getState().updateConfig('db', { size: 'large' });
    });
    fireEvent.click(screen.getByRole('tab', { name: /Results/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Cost' }));
    const items = screen.getAllByText(/^#\d$/);
    expect(items.map((e) => e.textContent)).toEqual(['#1', '#2']);
  });

  it('restores a submission into the draft without altering the submission', async () => {
    await openApp('#/challenges/read-heavy-api');
    act(() => {
      useStore.getState().loadDocument({ graph: REFERENCES['read-heavy-api'].one });
    });
    fireEvent.click(screen.getByRole('tab', { name: /Results/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const submitted = structuredClone(useLearning.getState().data.submissions[0]!.graph);
    act(() => {
      useStore.getState().updateConfig('api', { replicas: 15 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(useStore.getState().graph.nodes.find((n) => n.id === 'api')!.config?.replicas).toBe(9);
    expect(useLearning.getState().data.submissions[0]!.graph).toEqual(submitted);
  });

  it('keeps results from outdated challenge versions out of the rankings', async () => {
    await openApp('#/challenges/read-heavy-api');
    act(() => {
      useStore.getState().loadDocument({ graph: REFERENCES['read-heavy-api'].three });
    });
    fireEvent.click(screen.getByRole('tab', { name: /Results/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    act(() => {
      const [s] = useLearning.getState().data.submissions;
      useLearning.setState({ data: { ...useLearning.getState().data, submissions: [{ ...s!, challengeVersion: 0 }] } });
    });
    const history = screen.getByRole('heading', { name: 'History' }).closest('section')!;
    expect(within(history).getByText('older version')).toBeTruthy();
    expect(screen.getByText(/No passing submissions yet/)).toBeTruthy();
  });

  it('shows the playground simulation only when asked for', async () => {
    await openApp('#/playground');
    expect(screen.queryByText('Estimated results')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show simulation' }));
    expect(screen.getByText('Estimated results')).toBeTruthy();
    expect(screen.getByLabelText('Traffic')).toBeTruthy();
  });
});
