import type { Graph, NodeKind, Workload } from '../model/types.ts';
import type { SimResult } from '../simulation/simulate.ts';
import { graphOf } from '../model/builder.ts';

export interface LessonContext {
  graph: Graph;
  workload: Workload;
  /** Simulation of the learner's diagram, including the worst single-replica failure. */
  sim: SimResult;
}

export interface CheckOutcome {
  ok: boolean;
  /** What the learner currently sees, shown whether or not the step passes. */
  detail: string;
}

export type LessonStep =
  | {
      id: string;
      kind: 'number';
      prompt: string;
      unit: string;
      expected: number;
      /** Allowed relative error in percent; 0 means the exact value. */
      tolerancePct: number;
      explanation: string;
    }
  | {
      id: string;
      kind: 'graph';
      prompt: string;
      hint: string;
      check: (ctx: LessonContext) => CheckOutcome;
    };

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  /** Lessons worth finishing first; guidance only, nothing is locked. */
  prerequisites: string[];
  goals: string[];
  sections: { heading: string; body: string[] }[];
  starter: { graph: Graph; workload: Workload };
  steps: LessonStep[];
}

const kindOf = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)?.kind;

/** True when the diagram has a chain of connected components with exactly these kinds, in order. */
export function hasChain(graph: Graph, kinds: NodeKind[]): boolean {
  const next = (id: string) => graph.edges.filter((e) => e.source === id).map((e) => e.target);
  const walk = (id: string, i: number): boolean => {
    if (kindOf(graph, id) !== kinds[i]) return false;
    if (i === kinds.length - 1) return true;
    return next(id).some((t) => walk(t, i + 1));
  };
  return graph.nodes.some((n) => walk(n.id, 0));
}

export function answerCorrect(step: Extract<LessonStep, { kind: 'number' }>, value: number): boolean {
  return Math.abs(value - step.expected) <= (Math.abs(step.expected) * step.tolerancePct) / 100 + 1e-9;
}

const pct = (r: number | null) => (r === null ? 'n/a' : `${(r * 100).toFixed(1)}%`);

const maxUtilization = (sim: SimResult) => Math.max(0, ...Object.values(sim.nodes).filter((n) => n.arrivalRps > 0).map((n) => n.utilization));

const utilOfKind = (ctx: LessonContext, kind: NodeKind) =>
  Math.max(0, ...ctx.graph.nodes.filter((n) => n.kind === kind).map((n) => ctx.sim.nodes[n.id]?.utilization ?? 0));

const needsFix = (ctx: LessonContext): CheckOutcome | null =>
  ctx.sim.ok ? null : { ok: false, detail: ctx.sim.issues.find((i) => i.severity === 'error')?.message ?? 'The diagram cannot be simulated yet.' };

export const LESSONS: Lesson[] = [
  {
    id: 'estimation',
    title: 'Back-of-the-envelope estimation',
    summary: 'Turn users and habits into requests per second, then into the number of servers you need.',
    prerequisites: [],
    goals: ['Convert daily usage into average and peak requests per second', 'Size a service tier from per-instance capacity and a utilization target'],
    sections: [
      {
        heading: 'From users to requests per second',
        body: [
          'Start with who uses the system and how often. Daily active users times requests per user per day gives requests per day; divide by the 86,400 seconds in a day for the average rate.',
          'Traffic is never flat. Multiply the average by a peak factor (commonly 2–5×) to get the rate you must survive, not the rate you usually see.',
        ],
      },
      {
        heading: 'From requests to machines',
        body: [
          'Divide peak load by what one instance can serve to find how many you need. Never plan for 100% utilization: as a component fills up, waiting time grows sharply, so aim for around 70%.',
          'In the simulator a medium service replica handles 1,000 requests per second. Watch the utilization shown on each component as you change the workload.',
        ],
      },
    ],
    starter: {
      graph: graphOf(
        [
          ['clients', 'client', 'Users'],
          ['api', 'service', 'API', { size: 'medium', replicas: 1 }],
          ['db', 'database', 'Database', { size: 'large', replicas: 3 }],
        ],
        [['clients', 'api'], ['api', 'db']],
      ),
      workload: { rps: 1000, readRatio: 0.9, durationSec: 60 },
    },
    steps: [
      {
        id: 'avg', kind: 'number', unit: 'requests/s', expected: 2315, tolerancePct: 3,
        prompt: '10 million daily active users each make 20 requests a day. What is the average rate?',
        explanation: '10,000,000 × 20 ÷ 86,400 ≈ 2,315 requests per second.',
      },
      {
        id: 'peak', kind: 'number', unit: 'requests/s', expected: 6944, tolerancePct: 3,
        prompt: 'Peak traffic is 3× the average. What peak rate must the system handle?',
        explanation: '2,315 × 3 ≈ 6,944 requests per second.',
      },
      {
        id: 'replicas', kind: 'number', unit: 'replicas', expected: 10, tolerancePct: 0,
        prompt: 'A medium service replica serves 1,000 requests/s. How many replicas keep utilization at or under 70% at that peak?',
        explanation: '6,944 ÷ (1,000 × 0.7) = 9.9, so 10 replicas.',
      },
      {
        id: 'build', kind: 'graph',
        prompt: 'Set the workload to your peak estimate (about 6,944 requests/s) and scale the API service so it stays at or under 70% utilization without dropping requests.',
        hint: 'Change the traffic in the Workload panel, then select the API and raise its replicas.',
        check: (ctx) => {
          const blocked = needsFix(ctx);
          if (blocked) return blocked;
          const peakOk = Math.abs(ctx.workload.rps - 6944) <= 6944 * 0.05;
          const util = utilOfKind(ctx, 'service');
          const ok = peakOk && util <= 0.7 + 1e-9 && (ctx.sim.servedRatio ?? 0) >= 0.999;
          return { ok, detail: `Workload ${Math.round(ctx.workload.rps).toLocaleString()} rps · API utilization ${(util * 100).toFixed(0)}% · served ${pct(ctx.sim.servedRatio)}` };
        },
      },
    ],
  },
  {
    id: 'scaling',
    title: 'Scaling out',
    summary: 'Find the bottleneck, add capacity where it matters, and watch the bottleneck move.',
    prerequisites: ['estimation'],
    goals: ['Identify the saturated component from utilization', 'Scale horizontally and notice that fixing one bottleneck exposes the next', 'Balance capacity against monthly cost'],
    sections: [
      {
        heading: 'Vertical and horizontal scaling',
        body: [
          'Scaling up (a bigger machine) is simple but has a ceiling and leaves one machine to fail. Scaling out (more machines) has no such ceiling and adds redundancy, at the price of coordination.',
          'Every tier is a candidate bottleneck. When a component runs past 100% utilization it drops the excess, so the whole system serves only what its tightest tier allows.',
        ],
      },
      {
        heading: 'Fix the tightest tier first',
        body: [
          'The highlighted component with the highest utilization is the current bottleneck. Add capacity there, then re-check: the next tier often becomes the limit.',
          'Capacity is not free. Compare the cost shown in the results as you add replicas or pick bigger sizes.',
        ],
      },
    ],
    starter: {
      graph: graphOf(
        [
          ['clients', 'client', 'Users'],
          ['api', 'service', 'API', { size: 'medium', replicas: 1 }],
          ['db', 'database', 'Database', { size: 'medium', replicas: 1 }],
        ],
        [['clients', 'api'], ['api', 'db']],
      ),
      workload: { rps: 3000, readRatio: 0.9, durationSec: 60 },
    },
    steps: [
      {
        id: 'cap', kind: 'number', unit: 'replicas', expected: 4, tolerancePct: 0,
        prompt: 'A medium service replica serves 1,000 requests/s. How many replicas serve 3,000 requests/s at no more than 75% utilization?',
        explanation: '3,000 ÷ (1,000 × 0.75) = 4 replicas.',
      },
      {
        id: 'serve', kind: 'graph',
        prompt: 'Serve all 3,000 requests per second without dropping any.',
        hint: 'The API saturates first. Once it is fixed, check the database: reads need more database nodes.',
        check: (ctx) => {
          const blocked = needsFix(ctx);
          if (blocked) return blocked;
          const ok = (ctx.sim.servedRatio ?? 0) >= 0.999;
          const hot = ctx.sim.bottleneckId ? ctx.graph.nodes.find((n) => n.id === ctx.sim.bottleneckId)?.name : null;
          return { ok, detail: `Served ${pct(ctx.sim.servedRatio)} · tightest component: ${hot ?? 'none'}` };
        },
      },
      {
        id: 'headroom', kind: 'graph',
        prompt: 'Add headroom: keep every component at or under 85% utilization while staying within $1,200 per month.',
        hint: 'Compare small, medium and large sizes: bigger replicas are not always cheaper per request.',
        check: (ctx) => {
          const blocked = needsFix(ctx);
          if (blocked) return blocked;
          const util = maxUtilization(ctx.sim);
          const ok = util <= 0.85 + 1e-9 && ctx.sim.monthlyCostUsd <= 1200 && (ctx.sim.servedRatio ?? 0) >= 0.999;
          return { ok, detail: `Highest utilization ${(util * 100).toFixed(0)}% · $${ctx.sim.monthlyCostUsd.toLocaleString()}/mo` };
        },
      },
    ],
  },
  {
    id: 'load-balancing',
    title: 'Load balancing',
    summary: 'Spread traffic across replicas and see why the balancer itself must not be a single point of failure.',
    prerequisites: ['scaling'],
    goals: ['Put a load balancer in front of replicated services', 'Explain why every tier needs a spare replica to survive a failure'],
    sections: [
      {
        heading: 'What a load balancer does',
        body: [
          'A load balancer gives clients one address and spreads their requests across healthy replicas. Add replicas behind it to scale out; if one fails, traffic simply goes to the others.',
          'The animated edges show traffic splitting evenly at the balancer.',
        ],
      },
      {
        heading: 'Do not move the single point of failure',
        body: [
          'A single load balancer instance is itself a single point of failure. Run at least two, and keep enough spare capacity behind them that losing one replica does not overload the rest.',
          'The Failure result in the simulator removes one replica of the component that hurts most. If it reports less than 100% served, that component needs redundancy.',
        ],
      },
    ],
    starter: {
      graph: graphOf(
        [
          ['clients', 'client', 'Users'],
          ['api', 'service', 'API', { size: 'medium', replicas: 3 }],
          ['db', 'database', 'Database', { size: 'large', replicas: 2 }],
        ],
        [['clients', 'api'], ['api', 'db']],
      ),
      workload: { rps: 2000, readRatio: 0.9, durationSec: 60 },
    },
    steps: [
      {
        id: 'spare', kind: 'number', unit: 'replicas', expected: 3, tolerancePct: 0,
        prompt: 'You need 2,000 requests/s and a medium replica serves 1,000. How many replicas give you one spare (N+1)?',
        explanation: 'Two replicas carry the load; the third is the spare, so 3.',
      },
      {
        id: 'lb', kind: 'graph',
        prompt: 'Put a load balancer between the clients and the API.',
        hint: 'Drag a Load balancer onto the canvas and reconnect Users → Load balancer → API.',
        check: (ctx) => {
          const ok = hasChain(ctx.graph, ['client', 'loadBalancer', 'service']) && !ctx.graph.edges.some((e) => kindOf(ctx.graph, e.source) === 'client' && kindOf(ctx.graph, e.target) === 'service');
          return { ok, detail: ok ? 'Clients reach the API through a load balancer.' : 'Clients still reach the API directly.' };
        },
      },
      {
        id: 'survive', kind: 'graph',
        prompt: 'Survive the loss of any single replica while serving every request.',
        hint: 'Check the Failure result: it names the component whose loss hurts most.',
        check: (ctx) => {
          const blocked = needsFix(ctx);
          if (blocked) return blocked;
          const f = ctx.sim.failure;
          const ok = !!f && (f.servedRatio ?? 0) >= 0.999 && (ctx.sim.servedRatio ?? 0) >= 0.999;
          return { ok, detail: f ? `If ${f.nodeName} loses a replica: ${pct(f.servedRatio)} served` : 'No failure result yet.' };
        },
      },
    ],
  },
  {
    id: 'caching',
    title: 'Caching',
    summary: 'Absorb repeated reads in memory so the database only sees the misses.',
    prerequisites: ['scaling'],
    goals: ['Compute how a hit ratio reduces database load', 'Place a cache between a service and its database', 'Weigh latency and cost against load reduction'],
    sections: [
      {
        heading: 'Read-through caching',
        body: [
          'Reads that find their data in the cache never reach the database. Only misses, and all writes, continue to the next tier. A higher hit ratio means less database load.',
          'In the simulator a cache tier fixes its hit ratio: small 60%, medium 80%, large 90%. Bigger tiers cost more, so more memory is only worth it when the database is the bottleneck.',
        ],
      },
      {
        heading: 'Trade-offs',
        body: [
          'A cache adds a component to run and a hop to traverse, and cached data can be stale. It pays for itself when reads dominate and the data is read repeatedly.',
          'Writes are not helped by a read cache; the database primary still has to absorb every write.',
        ],
      },
    ],
    starter: {
      graph: graphOf(
        [
          ['clients', 'client', 'Users'],
          ['lb', 'loadBalancer', 'Load balancer', { replicas: 2 }],
          ['api', 'service', 'API', { size: 'medium', replicas: 8 }],
          ['db', 'database', 'Database', { size: 'medium', replicas: 1 }],
        ],
        [['clients', 'lb'], ['lb', 'api'], ['api', 'db']],
      ),
      workload: { rps: 6000, readRatio: 0.95, durationSec: 60 },
    },
    steps: [
      {
        id: 'misses', kind: 'number', unit: 'reads/s', expected: 1140, tolerancePct: 1,
        prompt: '5,700 reads per second reach a medium cache (80% hit ratio). How many reads per second reach the database?',
        explanation: '5,700 × (1 − 0.8) = 1,140 reads per second.',
      },
      {
        id: 'place', kind: 'graph',
        prompt: 'Place a cache between the API and the database.',
        hint: 'Connect API → Cache → Database and remove the direct API → Database connection.',
        check: (ctx) => {
          const ok = hasChain(ctx.graph, ['service', 'cache', 'database']) && !ctx.graph.edges.some((e) => kindOf(ctx.graph, e.source) === 'service' && kindOf(ctx.graph, e.target) === 'database');
          return { ok, detail: ok ? 'The API reads through a cache.' : 'The API still talks to the database directly.' };
        },
      },
      {
        id: 'relief', kind: 'graph',
        prompt: 'Relieve the database: serve every request with the database at or under 85% utilization.',
        hint: 'Selecting the Database shows its utilization. A larger cache tier raises the hit ratio.',
        check: (ctx) => {
          const blocked = needsFix(ctx);
          if (blocked) return blocked;
          const util = utilOfKind(ctx, 'database');
          const ok = util <= 0.85 + 1e-9 && (ctx.sim.servedRatio ?? 0) >= 0.999;
          return { ok, detail: `Database utilization ${(util * 100).toFixed(0)}% · served ${pct(ctx.sim.servedRatio)} · $${ctx.sim.monthlyCostUsd.toLocaleString()}/mo` };
        },
      },
    ],
  },
  {
    id: 'replication',
    title: 'Database replication',
    summary: 'Add read replicas for capacity and availability, and learn why writes do not scale the same way.',
    prerequisites: ['caching'],
    goals: ['Add read replicas to serve more reads', 'Explain why replicas do not raise write capacity', 'Keep serving after a database node fails'],
    sections: [
      {
        heading: 'Primary and replicas',
        body: [
          'In a primary–replica setup, all writes go to the primary and are copied to replicas. Reads can be served by any node, so adding replicas multiplies read capacity.',
          'In the simulator, every database node serves reads; only the primary accepts writes, and if it fails a replica is promoted.',
        ],
      },
      {
        heading: 'Capacity versus availability',
        body: [
          'Replicas also protect against failure: losing one node still leaves others serving. But the survivors must be able to carry the whole read load on their own.',
          'Write capacity does not grow with replicas. When writes are the limit, you need a bigger primary, batching, or a different design.',
        ],
      },
    ],
    starter: {
      graph: graphOf(
        [
          ['clients', 'client', 'Users'],
          ['lb', 'loadBalancer', 'Load balancer', { replicas: 2 }],
          ['api', 'service', 'API', { size: 'medium', replicas: 3 }],
          ['db', 'database', 'Database', { size: 'small', replicas: 1 }],
        ],
        [['clients', 'lb'], ['lb', 'api'], ['api', 'db']],
      ),
      workload: { rps: 1800, readRatio: 0.9, durationSec: 60 },
    },
    steps: [
      {
        id: 'nodes', kind: 'number', unit: 'nodes', expected: 3, tolerancePct: 0,
        prompt: 'A small database node serves 800 reads/s. How many nodes are needed for 1,620 reads/s?',
        explanation: '1,620 ÷ 800 = 2.03, so 3 nodes.',
      },
      {
        id: 'writes', kind: 'number', unit: 'writes/s', expected: 200, tolerancePct: 0,
        prompt: 'A small primary accepts 200 writes/s. How many writes per second can the database sustain with five read replicas?',
        explanation: 'Still 200: replicas copy writes, they do not accept them.',
      },
      {
        id: 'reads', kind: 'graph',
        prompt: 'Add read replicas until every request is served.',
        hint: 'Select the Database and raise its replicas (nodes).',
        check: (ctx) => {
          const blocked = needsFix(ctx);
          if (blocked) return blocked;
          const db = ctx.graph.nodes.find((n) => n.kind === 'database');
          const ok = (ctx.sim.servedRatio ?? 0) >= 0.999 && (db?.config?.replicas ?? 1) >= 2;
          return { ok, detail: `Served ${pct(ctx.sim.servedRatio)} · database nodes: ${db?.config?.replicas ?? 1}` };
        },
      },
      {
        id: 'failover', kind: 'graph',
        prompt: 'Keep serving every request even if any single database node fails.',
        hint: 'The remaining nodes must carry all reads. Look at the Failure result.',
        check: (ctx) => {
          const blocked = needsFix(ctx);
          if (blocked) return blocked;
          const f = ctx.sim.failure;
          const ok = !!f && (f.servedRatio ?? 0) >= 0.999;
          return { ok, detail: f ? `If ${f.nodeName} loses a replica: ${pct(f.servedRatio)} served` : 'No failure result yet.' };
        },
      },
    ],
  },
  {
    id: 'queues',
    title: 'Message queues',
    summary: 'Absorb a burst of writes with a queue, then drain it at the pace the database can sustain.',
    prerequisites: ['replication'],
    goals: ['Compute backlog from arrival and drain rates', 'Separate acknowledging a request from finishing the work', 'Size a queue and its consumers to drain in time'],
    sections: [
      {
        heading: 'Buffering bursts',
        body: [
          'A queue sits between a producer and a slower consumer. The producer is acknowledged as soon as the message is stored in the queue; the consumer does the work later, at its own pace.',
          'When arrivals exceed the drain rate, the backlog grows by the difference every second. If it passes the queue limit, messages are lost.',
        ],
      },
      {
        heading: 'Acknowledged is not delivered',
        body: [
          'The latency a caller sees stops at the queue. The work finishes only when the backlog empties, which takes backlog ÷ drain rate seconds after the burst ends.',
          'The drain rate is set by the slowest consumer in the chain, usually database writes on the primary. Speed up the bottleneck, not every tier.',
        ],
      },
    ],
    starter: {
      graph: graphOf(
        [
          ['clients', 'client', 'Producers'],
          ['api', 'service', 'API', { size: 'medium', replicas: 3 }],
          ['db', 'database', 'Database', { size: 'medium', replicas: 1 }],
        ],
        [['clients', 'api'], ['api', 'db']],
      ),
      workload: { rps: 2500, readRatio: 0, durationSec: 30 },
    },
    steps: [
      {
        id: 'backlog', kind: 'number', unit: 'messages', expected: 30000, tolerancePct: 0,
        prompt: 'Writes arrive at 1,500/s for 30 seconds while the database drains 500/s. How many messages are in the backlog when the burst ends?',
        explanation: '(1,500 − 500) × 30 = 30,000 messages.',
      },
      {
        id: 'queue', kind: 'graph',
        prompt: 'Insert a queue and a worker service between the API and the database so every write is accepted and none are lost.',
        hint: 'Connect API → Queue → Worker (a service) → Database.',
        check: (ctx) => {
          const blocked = needsFix(ctx);
          if (blocked) return blocked;
          const shape = hasChain(ctx.graph, ['service', 'queue', 'service', 'database']);
          const lost = ctx.sim.queue?.lostMessages ?? 0;
          const ok = shape && (ctx.sim.servedRatio ?? 0) >= 0.999 && lost === 0;
          return { ok, detail: shape ? `Served ${pct(ctx.sim.servedRatio)} · lost ${Math.round(lost).toLocaleString()} messages` : 'The diagram needs API → Queue → Worker → Database.' };
        },
      },
      {
        id: 'drain', kind: 'graph',
        prompt: 'Drain the backlog within 60 seconds after the burst ends.',
        hint: 'Draining is limited by the slowest consumer. Which one is it? Check the queue results.',
        check: (ctx) => {
          const blocked = needsFix(ctx);
          if (blocked) return blocked;
          const q = ctx.sim.queue;
          const ok = !!q && q.lostMessages === 0 && q.drainSeconds !== null && q.drainSeconds <= 60;
          return { ok, detail: q ? `Drain time ${q.drainSeconds === null ? 'never' : `${q.drainSeconds.toFixed(0)} s`} · drain rate ${Math.round(q.drainRps).toLocaleString()}/s` : 'Add a queue first.' };
        },
      },
    ],
  },
];

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}
