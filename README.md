# system-design-playground
Interactive system design diagrams, lessons and challenges.

The app has three sections that share one diagram editor and one simulator:

- **Playground**: free-form diagrams, with an opt-in simulation overlay.
- **Lessons**: six short, hands-on lessons (estimation, scaling, load balancing, caching, replication, queues). Each starts from a diagram, explains an idea, and has an activity that is checked against the diagram and the simulation (not by clicking Next).
- **Challenges**: three design briefs (read-heavy API, highly available API, bursty notification pipeline). A design is judged against published targets for cost, reliability, latency and delivery: meet the requirements for **1 star**, stricter targets for **2** and **3**.

Lessons are original explanations covering topics from the system design literature (for example *System Design Interview* by Alex Xu); they do not reproduce a book's text, figures or exercises. Everything is open: there are no unlock gates, and progress is tracked locally.

## Getting started

```bash
npm install
npm run dev        # start the app on http://localhost:5173
npm test           # run the simulation, judging, persistence and UI tests
npm run typecheck  # TypeScript project check
npm run build      # production build into dist/
```

## What you can do

- **Build diagrams** (React Flow): drag components (clients, CDN, load balancer, service, cache, queue, database) onto the canvas and connect them. Connections fed by a client animate to show traffic moving through the system.
- **Describe components your way**: components start with just a name. Add any custom properties (name/value pairs such as region, owner or notes) from the Properties panel; the first few show on the component.
- **Spot loose ends**: the Checks panel warns about a missing Clients component or components no client can reach.
- **Save your work**: undo/redo (Ctrl+Z / Ctrl+Shift+Z), autosave to `localStorage`, JSON export/import, and presets. Files from earlier versions still load; their ignored numeric fields are not reactivated.
- **Look and feel**: a blueprint-style light/dark theme, color-coded component types, and a minimap for larger diagrams.
- **Simulate**: set each component's size and replicas, choose a workload, and see per-component utilization, bottlenecks, latency, availability, cost and queue backlog on the canvas.
- **Keep work separate**: the Playground, every lesson and every challenge keep their own diagram (and undo history). Moving between them never overwrites another's diagram.

## Backups and local-only rankings

Progress, lesson/challenge drafts and submissions live in browser `localStorage` (separately from the Playground document). Use **Export backup / Import backup** on the Lessons or Challenges list to keep a durable copy; importing merges (progress and submissions are united, imported drafts replace current ones). Unreadable saved data is never silently dropped: a copy is kept under `system-design-playground:learning:corrupt-backup` and the app tells you.

Rankings compare **your own** passing submissions on this device. Scores are computed in the browser, so they are not trustworthy evidence across people or devices; shared leaderboards would need server-side evaluation. Each submission is an immutable snapshot recording the challenge, simulator and judge versions; results from older versions stay in history and are never mixed into current rankings.

## Simulation model

Everything is a **deterministic, closed-form estimate**: no randomness, and results never depend on node or connection order. Numbers are illustrative, not cloud prices or measurements. Catalog values live in `src/simulation/catalog.ts` and change `SIM_VERSION` when edited.

| Component | Settings | Per replica / unit |
| --- | --- | --- |
| Load balancer | replicas | 20,000 rps, 2 ms, $25/mo |
| Service | size, replicas | small 400 rps / 25 ms / $60; medium 1,000 / 20 ms / $130; large 2,500 / 15 ms / $300 |
| Cache | size, replicas | hit ratio is fixed by size: 60% / 80% / 90%; 20k / 40k / 80k rps; $40 / $90 / $200 |
| Database | size, nodes | reads per node 800 / 2,000 / 5,000; **writes only on the primary** 200 / 500 / 1,200; $120 / $260 / $600 per node |
| Queue | size | enqueue 5k / 10k / 20k per s; backlog limit 200k / 1M / 5M; $30 / $70 / $140 |
| CDN | none | serves 60% of reads at the edge, 15 ms, $150 |

- **Routing**: load balancers (and the single Clients component) split traffic evenly across their outgoing connections. Every other component has at most one outgoing connection (chain components, for example service → cache → database). Flows add up where connections join. Every path must end at a database.
- **Reads and writes**: caches and the CDN serve a share of reads and pass misses and all writes on. Writes always reach the database primary.
- **Saturation**: when offered load exceeds capacity a component serves only its capacity and drops the rest. *Served* is the share of requests that complete.
- **Latency**: each component adds `base × 1/(1 − utilization)` (utilization capped at 95%). *Mean* averages completed requests; *worst path* is the slowest path that carries traffic (a tail proxy, not a measured percentile). A queue ends the synchronous path at its acknowledgement.
- **Availability**: each component is up if at least *k* of its *n* replicas are, where *k* is the replicas needed for the load and each replica is up with a fixed probability (LB 99.9%, service/cache/database 99.5%, CDN/queue 99.99%), assuming independent failures. A path multiplies its components; a design that cannot carry its load has availability 0.
- **Failure**: the failure scenario removes one replica of whichever component hurts most. A component with one replica is a single point of failure.
- **Queues**: a queue acknowledges writes immediately. Its drain rate is the lowest capacity-to-share ratio of its consumers. Backlog grows by `(arrival − drain) × duration`, capped at the queue limit (excess is lost and counted as failed requests); the backlog empties `backlog ÷ drain` seconds after the burst ends.
- **Cost**: every provisioned component is billed, including disconnected ones.

**Not modeled**: consistency and replication lag, sharding, consistent hashing, rate limiting, retries, partial failures, correlated failures, multiple queues, read traffic through a queue, shared consumers between queued and direct traffic, fan-out, and cache invalidation. Unsupported shapes fail with an explicit message instead of returning a result.

## Challenge judging

Each challenge defines scenarios (normal, peak, one-replica failure), criteria and weights. Every scenario runs against the same submitted snapshot.

- **Stars**: any structural problem (cannot simulate, no service on the path to the database, too many components) or any unmet 1-star target gives **0 stars**, regardless of score. 2 and 3 stars need *all* of their published targets.
- **Score**: each criterion is mapped monotonically between fixed best/worst reference points and combined with the published weights. It does not depend on other submissions.
- **Ranking** (personal): stars, then score, then earlier submission; separate views rank by cost, latency and reliability. Ties share a rank.
- Reference solutions that attain every tier are checked in tests (`src/challenges/references.ts`, not shipped in the app).

## Architecture

```
src/
  model/        plain serializable types, component kinds, simulation settings, presets, graph checks, document (de)serialization
  simulation/   catalog of capacities/costs, topology validation and the deterministic simulator
  challenges/   challenge definitions, judge, personal rankings (+ test-only reference solutions)
  content/      lesson content and activity checks
  learning/     learning data schema: progress, drafts, submissions, backup merge
  store/        Zustand stores (editor, learning data) + persistence and workspace switching
  pages/        playground, lessons and challenges pages
  ui/           shared React components (editor, palette, properties, simulation panels, toolbar)
  index.css     Tailwind entry: theme tokens and a few shared component classes (btn, input, card)
```

Styling uses [Tailwind CSS](https://tailwindcss.com) v4. Traffic flows top to bottom through a **DAG**; connections that would create a cycle are rejected.
