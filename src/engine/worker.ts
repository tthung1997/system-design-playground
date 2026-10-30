/// <reference lib="webworker" />
import { GraphError } from './graph.ts';
import { simulate } from './simulate.ts';
import type { Graph, Scenario } from '../model/types.ts';

export interface WorkerRequest {
  id: number;
  graph: Graph;
  scenario: Scenario;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, graph, scenario } = event.data;
  try {
    self.postMessage({ id, result: simulate(graph, scenario) });
  } catch (e) {
    const message = e instanceof GraphError || e instanceof Error ? e.message : String(e);
    self.postMessage({ id, error: message });
  }
};
