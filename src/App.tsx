import { useEffect, useLayoutEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { validateGraph } from './model/graph.ts';
import { saveDocument } from './store/storage.ts';
import { useStore } from './store/useStore.ts';
import { Editor } from './ui/Editor.tsx';
import { Palette } from './ui/Palette.tsx';
import { Properties } from './ui/Properties.tsx';
import { AlertIcon } from './ui/icons.tsx';
import { Toolbar } from './ui/Toolbar.tsx';

function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.graph === prev.graph) return;
      clearTimeout(timer);
      timer = setTimeout(() => saveDocument({ graph: s.graph }), 400);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);
}

function useShortcuts() {
  useEffect(() => {
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
  }, []);
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

function Checks() {
  const graph = useStore((s) => s.graph);
  const issues = validateGraph(graph);
  if (issues.length === 0) return null;
  return (
    <section className="card">
      <h2 className="card-title">Checks</h2>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {issues.map((i, k) => (
          <li key={k} className="warn">
            <AlertIcon size={14} className="mt-px shrink-0" />
            {i.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function App() {
  useAutosave();
  useShortcuts();
  const [isDark, toggleTheme] = useTheme();

  return (
    <ReactFlowProvider>
      <div className="grid h-screen grid-cols-[220px_minmax(0,1fr)_260px] grid-rows-[auto_minmax(0,1fr)] font-sans lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <Toolbar isDark={isDark} onToggleTheme={toggleTheme} />
        <aside className="flex flex-col gap-3 overflow-y-auto border-r border-line bg-panel p-4">
          <Palette />
        </aside>
        <main className="relative min-h-0 min-w-0">
          <Editor />
        </main>
        <aside className="flex flex-col gap-3 overflow-y-auto border-l border-line bg-panel p-4">
          <Properties />
          <Checks />
        </aside>
      </div>
    </ReactFlowProvider>
  );
}
