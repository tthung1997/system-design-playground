# system-design-playground
Interactive system design diagrams, simulations, and learning challenges for balancing cost and peak-load capacity.

This repository currently contains the **diagram editor and simulation engine**; lessons/challenges and deployment are not included yet.

## Getting started

```bash
npm install
npm run dev        # start the app on http://localhost:5173
npm test           # run the engine, model and store tests
npm run typecheck  # TypeScript project check
npm run build      # production build into dist/
```

## What you can do

- **Build diagrams** (React Flow): drag components (clients, CDN, load balancer, service, cache, queue, database) onto the canvas, connect them, and edit their properties (instances, capacity, latency, cost, hit rate, queue depth, autoscaling).
- **See bottlenecks instantly**: the canvas always shows a steady-state analysis at the scenario's peak load — utilization colors, flow along edges, dropped traffic, latency, cost, max throughput and headroom.
- **Run a time-stepped simulation** over a traffic profile (constant, daily cycle, spike, ramp or custom points) with seeded noise. Play, pause, change speed and scrub through time; node overlays and charts follow the cursor. Simulations run in a Web Worker.
- **Compare cost vs peak capacity**: total/average cost, cost per million requests, capacity at peak, headroom, capacity used, drop rate, time over capacity and latency.
- **Save your work**: undo/redo (Ctrl+Z / Ctrl+Shift+Z), autosave to `localStorage`, JSON export/import, and presets.

## Architecture

```
src/
  model/    plain serializable types, node defaults, presets, document (de)serialization
  engine/   framework-independent simulation code (no React)
    graph.ts      validation, cycle detection, topology compilation
    flow.ts       core per-step load propagation, latency and capacity limits
    analyze.ts    steady-state (analytical) analysis
    simulate.ts   time-stepped simulation: queues, cache warm-up, autoscaling lag, cost
    traffic.ts    traffic profiles
    summary.ts    cost vs capacity summary
    worker.ts / client.ts   Web Worker wrapper with main-thread fallback
  store/    Zustand store (graph, scenario, selection, undo/redo, playback) + persistence
  ui/       React components (editor, palette, properties, scenario, charts, playback)
  index.css Tailwind entry: theme tokens and a few shared component classes (btn, input, card)
```

Styling uses [Tailwind CSS](https://tailwindcss.com) v4 (utility classes in components) and charts use [Recharts](https://recharts.org). Long runs are downsampled to ~400 points per chart, keeping each bucket's peak so spikes stay visible.

### Model semantics

- Traffic flows left to right through a **DAG**; cycles are rejected.
- A node serves `min(arrival, instances × capacityPerInstance)`; the rest is dropped.
- **Edges split** a node's forwarded traffic by their relative *traffic weight*.
- **Cache/CDN** nodes answer `hitRate` of served requests locally (ramping up over the warm-up time in simulations); misses go downstream.
- **Queues** drain at consumer throughput, buffer up to *max backlog* and drop beyond it.
- **Autoscaling** targets a utilization; new instances are billed immediately but only serve after the *provisioning delay*, and instances are removed after the *scale-in cooldown*.
- Latency is each node's base latency inflated as utilization approaches 100%, plus queue wait.
