import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { validateGraph } from './model/graph.ts';
import { saveDocument } from './store/storage.ts';
import { useStore } from './store/useStore.ts';
import { Editor } from './ui/Editor.tsx';
import { Palette } from './ui/Palette.tsx';
import { Properties } from './ui/Properties.tsx';
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

function Checks() {
  const graph = useStore((s) => s.graph);
  const issues = validateGraph(graph);
  if (issues.length === 0) return null;
  return (
    <section className="card">
      <h2 className="card-title">Checks</h2>
      <ul className="m-0 list-none space-y-1 p-0 text-xs">
        {issues.map((i, k) => (
          <li key={k} className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
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

  return (
    <ReactFlowProvider>
      <div className="grid h-screen grid-cols-[220px_minmax(0,1fr)_260px] grid-rows-[auto_minmax(0,1fr)] font-sans lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <Toolbar />
        <aside className="flex flex-col gap-2.5 overflow-y-auto border-r border-slate-200 bg-slate-100 p-2.5">
          <Palette />
        </aside>
        <main className="relative min-h-0 min-w-0 [&_.react-flow]:bg-slate-50">
          <Editor />
        </main>
        <aside className="flex flex-col gap-2.5 overflow-y-auto border-l border-slate-200 bg-slate-100 p-2.5">
          <Properties />
          <Checks />
        </aside>
      </div>
    </ReactFlowProvider>
  );
}
