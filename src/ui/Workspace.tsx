import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { WorkspaceSnapshot } from '../learning/data.ts';
import { useStore } from '../store/useStore.ts';
import { Editor } from './Editor.tsx';
import type { Overlay } from './Editor.tsx';
import { Palette } from './Palette.tsx';

/**
 * Switches the editor to a workspace and renders nothing until that has happened, so a page can
 * never read, edit or autosave another workspace's diagram.
 */
export function WorkspaceGate({ workspaceKey, seed, children }: { workspaceKey: string; seed: WorkspaceSnapshot; children: ReactNode }) {
  const switchWorkspace = useStore((s) => s.switchWorkspace);
  const current = useStore((s) => s.workspace);
  const seedRef = useRef(seed);
  seedRef.current = seed;
  useLayoutEffect(() => {
    switchWorkspace(workspaceKey, seedRef.current);
  }, [workspaceKey, switchWorkspace]);
  if (current !== workspaceKey) return null;
  return <>{children}</>;
}

/** Palette, canvas and a right-hand panel. On narrow screens the three stack and the page scrolls. */
export function EditorLayout({ overlay, wide, children }: { overlay?: Overlay | null; wide?: boolean; children: ReactNode }) {
  const columns = wide
    ? 'md:grid-cols-[200px_minmax(0,1fr)_340px] lg:grid-cols-[240px_minmax(0,1fr)_420px]'
    : 'md:grid-cols-[200px_minmax(0,1fr)_260px] lg:grid-cols-[260px_minmax(0,1fr)_320px]';
  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:overflow-hidden ${columns}`}>
      <aside className="flex max-h-60 shrink-0 flex-col gap-3 overflow-y-auto border-b border-line bg-panel p-4 md:max-h-none md:border-r md:border-b-0">
        <Palette />
      </aside>
      <main className="relative h-[60vh] min-h-0 min-w-0 shrink-0 md:h-auto">
        <Editor overlay={overlay} />
      </main>
      <aside className="flex shrink-0 flex-col gap-3 border-t border-line bg-panel p-4 md:overflow-y-auto md:border-t-0 md:border-l">{children}</aside>
    </div>
  );
}
