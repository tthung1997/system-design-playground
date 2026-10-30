import { NODE_KINDS, NODE_SPECS } from '../model/defaults.ts';
import type { NodeKind } from '../model/types.ts';
import { DRAG_MIME, useAddNodeAtCenter } from './Editor.tsx';

export function Palette() {
  const add = useAddNodeAtCenter();
  return (
    <section className="card">
      <h2 className="card-title">Components</h2>
      <p className="hint">Drag onto the canvas, or click to add.</p>
      <div className="grid grid-cols-2 gap-1.5">
        {NODE_KINDS.map((kind: NodeKind) => {
          const spec = NODE_SPECS[kind];
          return (
            <button
              key={kind}
              type="button"
              className="btn flex cursor-grab items-center gap-1.5 text-left text-[13px]"
              draggable
              title={spec.description}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, kind);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => add(kind)}
            >
              <span aria-hidden>{spec.icon}</span>
              {spec.label}
            </button>
          );
        })}
      </div>
      <p className="hint">Connect nodes by dragging from a right handle to a left handle.</p>
    </section>
  );
}
