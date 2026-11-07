import { useState } from 'react';
import { DEFAULT_WORKLOAD } from '../model/defaults.ts';
import { PRESETS } from '../model/presets.ts';
import { useStore } from '../store/useStore.ts';
import { PLAYGROUND } from '../store/workspaces.ts';
import { Checks } from '../ui/Checks.tsx';
import { Properties } from '../ui/Properties.tsx';
import { overlayOf, ResultsCard, useSimulation, WorkloadCard } from '../ui/SimulationPanel.tsx';
import { EditorLayout, WorkspaceGate } from '../ui/Workspace.tsx';

function PlaygroundBody() {
  const [simulate, setSimulate] = useState(false);
  const result = useSimulation(simulate);
  const graph = useStore((s) => s.graph);
  const names = Object.fromEntries(graph.nodes.map((n) => [n.id, n.name]));
  return (
    <EditorLayout overlay={overlayOf(result)}>
      <section className="card">
        <label className="flex cursor-pointer items-center gap-2.5 text-[13px] font-semibold">
          <input type="checkbox" className="size-4 accent-(--accent)" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
          Show simulation
        </label>
        <p className="hint mb-0">Estimate load, latency, availability and cost for this diagram. Components show their utilization on the canvas.</p>
      </section>
      {simulate && (
        <>
          <WorkloadCard />
          <ResultsCard result={result} names={names} />
        </>
      )}
      <Properties />
      <Checks />
    </EditorLayout>
  );
}

export function PlaygroundPage() {
  return (
    <WorkspaceGate workspaceKey={PLAYGROUND} seed={{ graph: PRESETS[0]!.graph, workload: DEFAULT_WORKLOAD }}>
      <PlaygroundBody />
    </WorkspaceGate>
  );
}
