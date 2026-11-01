import { useEffect, useRef } from 'react';
import { createNode } from '../model/defaults.ts';
import { parseDocument, serializeDocument } from '../model/document.ts';
import { PRESETS } from '../model/presets.ts';
import { useStore } from '../store/useStore.ts';
import { CloseIcon, DownloadIcon, FileIcon, Logo, MoonIcon, RedoIcon, SunIcon, UndoIcon, UploadIcon } from './icons.tsx';

interface ToolbarProps {
  isDark: boolean;
  onToggleTheme: () => void;
}

export function Toolbar({ isDark, onToggleTheme }: ToolbarProps) {
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const notice = useStore((s) => s.notice);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const loadPreset = useStore((s) => s.loadPreset);
  const loadDocument = useStore((s) => s.loadDocument);
  const setNotice = useStore((s) => s.setNotice);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice, setNotice]);

  const exportJson = () => {
    const { graph } = useStore.getState();
    const blob = new Blob([serializeDocument({ graph })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'system-design.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    const parsed = parseDocument(await file.text());
    if (parsed.ok) {
      loadDocument(parsed.doc);
      setNotice(`Loaded ${file.name}`);
    } else {
      setNotice(`Could not load ${file.name}: ${parsed.error}`);
    }
  };

  const themeLabel = `Switch to ${isDark ? 'light' : 'dark'} mode`;

  return (
    <header className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-2.5">
      <div className="flex items-center gap-2.5 pr-1">
        <Logo />
        <h1 className="m-0 leading-tight">
          <span className="block text-[15px] font-bold tracking-tight">System Design</span>
          <span className="block text-[10px] font-medium tracking-[0.22em] text-muted uppercase">Playground</span>
        </h1>
      </div>

      <span className="h-6 w-px bg-line" aria-hidden />

      <div className="flex items-center gap-1.5">
        <button type="button" className="btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <UndoIcon size={16} />
          <span className="hidden xl:inline">Undo</span>
        </button>
        <button type="button" className="btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          <RedoIcon size={16} />
          <span className="hidden xl:inline">Redo</span>
        </button>
      </div>

      <span className="h-6 w-px bg-line" aria-hidden />

      <div className="flex items-center gap-1.5">
        <select
          className="input py-1.5 pr-7 text-[13px] font-medium"
          value=""
          aria-label="Load a preset"
          onChange={(e) => {
            if (e.target.value) loadPreset(e.target.value);
          }}
        >
          <option value="">Load a preset…</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id} title={p.description}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          onClick={() => loadDocument({ graph: { nodes: [createNode('client', 'client-1', { x: 0, y: 120 }, 'Users')], edges: [] } })}
        >
          <FileIcon size={16} />
          New
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          <UploadIcon size={16} />
          Import
        </button>
        <button type="button" className="btn btn-primary" onClick={exportJson}>
          <DownloadIcon size={16} />
          Export
        </button>
        <button type="button" className="btn btn-icon" onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel}>
          {isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importJson(f);
          }}
        />
      </div>

      {notice && (
        <div
          className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-panel px-4 py-2.5 text-[13px] shadow-(--elevation)"
          role="status"
        >
          <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden />
          {notice}
          <button type="button" className="rounded p-0.5 text-muted hover:text-ink" onClick={() => setNotice(null)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </header>
  );
}
