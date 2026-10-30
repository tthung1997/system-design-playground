import { useEffect, useRef } from 'react';
import { createNode, DEFAULT_SCENARIO } from '../model/defaults.ts';
import { parseDocument, serializeDocument } from '../model/document.ts';
import { PRESETS } from '../model/presets.ts';
import { useStore } from '../store/useStore.ts';

export function Toolbar() {
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
    const { graph, scenario } = useStore.getState();
    const blob = new Blob([serializeDocument({ graph, scenario })], { type: 'application/json' });
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

  return (
    <header className="col-span-full flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-3.5 py-2">
      <h1 className="mr-2 text-base font-semibold">System Design Playground</h1>
      <div className="flex items-center gap-1.5">
        <button type="button" className="btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button type="button" className="btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-1.5 text-slate-500">
          Presets
          <select
            className="input"
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
        </label>
        <button
          type="button"
          className="btn"
          onClick={() =>
            loadDocument({
              graph: { nodes: [createNode('client', 'client-1', { x: 0, y: 120 }, {}, 'Users')], edges: [] },
              scenario: { ...DEFAULT_SCENARIO },
            })
          }
        >
          New
        </button>
        <button type="button" className="btn" onClick={exportJson}>
          Export
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Import
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
        <div className="ml-auto flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1" role="status">
          {notice}
          <button type="button" className="px-0.5 text-slate-500" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </header>
  );
}
