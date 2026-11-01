import { NODE_KINDS, NODE_SPECS } from '../model/defaults.ts';
import type { NodeKind } from '../model/types.ts';
import { DRAG_MIME, useAddNodeAtCenter } from './Editor.tsx';
import { KindTile } from './icons.tsx';

export function Palette() {
  const add = useAddNodeAtCenter();
  return (
    <section>
      <h2 className="card-title">Components</h2>
      <div className="grid grid-cols-1 gap-2">
        {NODE_KINDS.map((kind: NodeKind) => {
          const spec = NODE_SPECS[kind];
          return (
            <button
              key={kind}
              type="button"
              className="btn cursor-grab justify-start gap-2.5 px-2.5 py-2 text-left active:cursor-grabbing"
              draggable
              title={spec.description}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, kind);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => add(kind)}
            >
              <KindTile kind={kind} size={28} />
              <span className="min-w-0">
                <span className="block truncate">{spec.label}</span>
                <span className="block truncate text-[11px] font-normal text-muted">{spec.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="hint">Drag onto the canvas, or click to add.</p>
      <p className="hint">Connect components by dragging from a bottom handle to a top handle.</p>
    </section>
  );
}
