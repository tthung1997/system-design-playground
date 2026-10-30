import type { Graph, Scenario } from '../model/types.ts';
import { simulate } from './simulate.ts';
import type { SimulationResult } from './simulate.ts';

interface Pending {
  resolve: (r: SimulationResult) => void;
  reject: (e: Error) => void;
  graph: Graph;
  scenario: Scenario;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function runInline(graph: Graph, scenario: Scenario): Promise<SimulationResult> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(simulate(graph, scenario));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }, 0);
  });
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (event: MessageEvent<{ id: number; result?: SimulationResult; error?: string }>) => {
      const { id, result, error } = event.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (result) p.resolve(result);
      else p.reject(new Error(error ?? 'Simulation failed'));
    };
    w.onerror = () => {
      // Worker unavailable (e.g. blocked); rerun pending jobs on the main thread.
      w.terminate();
      worker = null;
      const jobs = [...pending.values()];
      pending.clear();
      for (const j of jobs) runInline(j.graph, j.scenario).then(j.resolve, j.reject);
    };
    worker = w;
    return w;
  } catch {
    return null;
  }
}

/** Runs the simulation in a Web Worker, falling back to the main thread when unavailable. */
export function runSimulationAsync(graph: Graph, scenario: Scenario): Promise<SimulationResult> {
  const w = getWorker();
  if (!w) return runInline(graph, scenario);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, graph, scenario });
    w.postMessage({ id, graph, scenario });
  });
}
