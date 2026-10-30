import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { saveDocument } from './store/storage.ts';
import { useStore } from './store/useStore.ts';
import { Charts } from './ui/Charts.tsx';
import { Editor } from './ui/Editor.tsx';
import { Palette } from './ui/Palette.tsx';
import { PlaybackBar, usePlayback } from './ui/PlaybackBar.tsx';
import { Properties } from './ui/Properties.tsx';
import { ScenarioPanel } from './ui/ScenarioPanel.tsx';
import { Summary } from './ui/Summary.tsx';
import { Toolbar } from './ui/Toolbar.tsx';
import { useDerived } from './ui/useDerived.ts';

function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.graph === prev.graph && s.scenario === prev.scenario) return;
      clearTimeout(timer);
      timer = setTimeout(() => saveDocument({ graph: s.graph, scenario: s.scenario }), 400);
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

export default function App() {
  const derived = useDerived();
  usePlayback();
  useAutosave();
  useShortcuts();

  return (
    <ReactFlowProvider>
      <div className="grid h-screen grid-cols-[220px_minmax(0,1fr)_260px] grid-rows-[auto_minmax(0,1fr)_auto] font-sans lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <Toolbar />
        <aside className="flex flex-col gap-2.5 overflow-y-auto border-r border-slate-200 bg-slate-100 p-2.5">
          <Palette />
          <ScenarioPanel />
        </aside>
        <main className="relative min-h-0 min-w-0 [&_.react-flow]:bg-slate-50">
          <Editor derived={derived} />
        </main>
        <aside className="flex flex-col gap-2.5 overflow-y-auto border-l border-slate-200 bg-slate-100 p-2.5">
          <Properties derived={derived} />
          <Summary derived={derived} />
        </aside>
        <footer className="col-span-full flex max-h-[44vh] min-h-0 flex-col border-t border-slate-200 bg-white">
          <PlaybackBar />
          <Charts />
        </footer>
      </div>
    </ReactFlowProvider>
  );
}
