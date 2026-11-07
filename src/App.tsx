import { useEffect, useLayoutEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useRoute } from './app/route.ts';
import type { Route } from './app/route.ts';
import { ChallengePage, ChallengesPage } from './pages/ChallengesPage.tsx';
import { LessonPage, LessonsPage } from './pages/LessonsPage.tsx';
import { PlaygroundPage } from './pages/PlaygroundPage.tsx';
import { useLearning } from './store/learningStore.ts';
import { useStore } from './store/useStore.ts';
import { flushPending, onSaveError, scheduleSave } from './store/workspaces.ts';
import { AlertIcon, CloseIcon } from './ui/icons.tsx';
import { Toolbar } from './ui/Toolbar.tsx';

/** Saves whichever workspace is active; pending changes are flushed before switching or leaving. */
function useAutosave() {
  useEffect(() => {
    onSaveError((message) => useStore.getState().setNotice(message));
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.workspace !== prev.workspace) return;
      if (s.graph === prev.graph && s.workload === prev.workload) return;
      scheduleSave(s.workspace, { graph: s.graph, workload: s.workload });
    });
    const flush = () => flushPending();
    window.addEventListener('pagehide', flush);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', flush);
      flushPending();
    };
  }, []);
}

function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const s = useStore.getState();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        s.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

function useTheme() {
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem('system-design-playground:theme');
      if (saved === 'dark' || saved === 'light') return saved === 'dark';
    } catch {
      // Theme selection still works for this session when storage is unavailable.
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('system-design-playground:theme', isDark ? 'dark' : 'light');
    } catch {
      // Keep the selected theme for this session when storage is unavailable.
    }
  }, [isDark]);

  return [isDark, () => setIsDark((current) => !current)] as const;
}

function LoadWarnings() {
  const warnings = useLearning((s) => s.warnings);
  const dismiss = useLearning((s) => s.dismissWarnings);
  if (warnings.length === 0) return null;
  return (
    <div className="border-b border-line bg-panel px-4 py-2" role="alert">
      <div className="warn">
        <AlertIcon size={14} className="mt-px shrink-0" />
        <ul className="m-0 flex-1 list-none space-y-0.5 p-0">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <button type="button" className="rounded p-0.5 hover:opacity-70" onClick={dismiss} aria-label="Dismiss warnings">
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}

function Page({ route }: { route: Route }) {
  if (route.page === 'lessons') return route.id ? <LessonPage id={route.id} /> : <LessonsPage />;
  if (route.page === 'challenges') return route.id ? <ChallengePage id={route.id} /> : <ChallengesPage />;
  return <PlaygroundPage />;
}

export default function App() {
  const [route] = useRoute();
  useAutosave();
  useShortcuts(route.page === 'playground' || route.id !== undefined);
  const [isDark, toggleTheme] = useTheme();

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col font-sans">
        <Toolbar isDark={isDark} onToggleTheme={toggleTheme} route={route} />
        <LoadWarnings />
        <Page route={route} />
      </div>
    </ReactFlowProvider>
  );
}
