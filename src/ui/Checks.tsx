import { validateGraph } from '../model/graph.ts';
import { useStore } from '../store/useStore.ts';
import { AlertIcon } from './icons.tsx';

export function Checks() {
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
