import { graphOf } from '../model/builder.ts';
import type { ChallengeDef } from './types.ts';

const starter = () => graphOf([['clients', 'client', 'Users']], []);

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'read-heavy-api',
    version: 1,
    title: 'Read-heavy lookup API',
    difficulty: 'Starter',
    summary: 'Serve a link-lookup API where almost every request is a read, without overspending.',
    story: [
      'A link-lookup service redirects millions of short links. Reads dominate: about 95% of requests only look a link up, and the rest create new links.',
      'Traffic is steady during the day with a sharp evening peak. Design a system that serves the peak without dropping requests while keeping latency low and the monthly bill reasonable.',
    ],
    requirements: [
      'Serve at least 99.9% of requests at both normal (2,000 rps) and peak (8,000 rps) traffic.',
      'Every request must reach the database through a service tier.',
      'Keep the estimated worst-path latency, availability and monthly cost inside the published targets.',
    ],
    scenarios: [
      { id: 'normal', label: 'Normal traffic', workload: { rps: 2000, readRatio: 0.95, durationSec: 60 } },
      { id: 'peak', label: 'Evening peak', workload: { rps: 8000, readRatio: 0.95, durationSec: 60 } },
    ],
    criteria: [
      {
        id: 'normal-served', label: 'Served at normal traffic', category: 'reliability', metric: 'servedPct', scenarioId: 'normal',
        better: 'higher', tiers: [99.9, 99.9, 99.9], best: 100, worst: 99, weight: 0.5, unit: '%',
        hint: 'Check which component is saturated and add capacity there.',
      },
      {
        id: 'peak-served', label: 'Served at peak traffic', category: 'reliability', metric: 'servedPct', scenarioId: 'peak',
        better: 'higher', tiers: [99.9, 99.9, 99.9], best: 100, worst: 90, weight: 1, unit: '%',
        hint: 'Reads that miss every cache still reach the database; size the service tier and database for the peak.',
      },
      {
        id: 'peak-latency', label: 'Worst-path latency at peak', category: 'latency', metric: 'tailLatencyMs', scenarioId: 'peak',
        better: 'lower', tiers: [300, 160, 130], best: 80, worst: 320, weight: 1.5, unit: 'ms',
        hint: 'Components running near full utilization add queueing delay; leave headroom or add an edge cache.',
      },
      {
        id: 'peak-availability', label: 'Modeled availability at peak', category: 'reliability', metric: 'availabilityPct', scenarioId: 'peak',
        better: 'higher', tiers: [98, 99.5, 99.8], best: 99.95, worst: 97, weight: 1.5, unit: '%',
        hint: 'Availability falls when every replica is needed to carry load; spare replicas and fewer single points help.',
      },
      {
        id: 'cost', label: 'Monthly cost', category: 'cost', metric: 'costUsd',
        better: 'lower', tiers: [2400, 1600, 1450], best: 1000, worst: 2600, weight: 2, unit: 'USD',
        hint: 'Every provisioned component is billed, including ones that carry no traffic.',
      },
    ],
    primaryScenarioId: 'peak',
    requiredOnEveryPath: ['service'],
    maxComponents: 12,
    starter: starter(),
  },
  {
    id: 'highly-available-api',
    version: 1,
    title: 'Highly available API',
    difficulty: 'Intermediate',
    summary: 'Keep a read-mostly API serving while any single replica fails.',
    story: [
      'An order-status API backs a checkout flow, so downtime directly loses revenue. It carries 3,000 requests per second, mostly reads.',
      'Design it so that losing any one replica of any component still serves the load. Over-provisioning everything works, but the budget is limited.',
    ],
    requirements: [
      'Serve at least 99.9% of 3,000 rps (90% reads) with every component healthy.',
      'When any single replica of any component fails, keep serving at least 99% (higher tiers: 99.9%) of requests.',
      'Every request must reach the database through a service tier.',
    ],
    scenarios: [
      { id: 'steady', label: 'All components healthy', workload: { rps: 3000, readRatio: 0.9, durationSec: 60 } },
      { id: 'failure', label: 'One replica fails', workload: { rps: 3000, readRatio: 0.9, durationSec: 60 }, failure: true },
    ],
    criteria: [
      {
        id: 'steady-served', label: 'Served when healthy', category: 'reliability', metric: 'servedPct', scenarioId: 'steady',
        better: 'higher', tiers: [99.9, 99.9, 99.9], best: 100, worst: 95, weight: 0.5, unit: '%',
        hint: 'Size every tier for the steady load first.',
      },
      {
        id: 'failure-served', label: 'Served after a single replica failure', category: 'reliability', metric: 'servedPct', scenarioId: 'failure',
        better: 'higher', tiers: [99, 99.9, 99.9], best: 100, worst: 80, weight: 2, unit: '%',
        hint: 'A component with one replica is a single point of failure, and N replicas that are all needed give no protection; keep spare capacity.',
      },
      {
        id: 'availability', label: 'Modeled availability', category: 'reliability', metric: 'availabilityPct', scenarioId: 'steady',
        better: 'higher', tiers: [99.9, 99.95, 99.99], best: 99.998, worst: 99.5, weight: 2, unit: '%',
        hint: 'Availability is the chance that enough replicas are up to carry the load, for every component on the path.',
      },
      {
        id: 'failure-latency', label: 'Worst-path latency during a failure', category: 'latency', metric: 'tailLatencyMs', scenarioId: 'failure',
        better: 'lower', tiers: [450, 200, 130], best: 60, worst: 450, weight: 1, unit: 'ms',
        hint: 'After a failure the surviving replicas run hotter; headroom keeps queueing delay low.',
      },
      {
        id: 'cost', label: 'Monthly cost', category: 'cost', metric: 'costUsd',
        better: 'lower', tiers: [2200, 1700, 1450], best: 1100, worst: 2400, weight: 1.5, unit: 'USD',
        hint: 'Redundancy costs money; spend it where a single failure would stop traffic.',
      },
    ],
    primaryScenarioId: 'steady',
    failureScenarioId: 'failure',
    requiredOnEveryPath: ['service'],
    maxComponents: 12,
    starter: starter(),
  },
  {
    id: 'bursty-notifications',
    version: 1,
    title: 'Bursty notification pipeline',
    difficulty: 'Advanced',
    summary: 'Accept a flash-sale burst of notification requests and deliver every one without loss.',
    story: [
      'A marketing campaign fires 3,000 notification requests per second for a minute, far more than the database can write. Callers only need a quick acknowledgement; delivery can finish afterwards.',
      'Design an ingest path that acknowledges quickly, never loses a message, drains the backlog in reasonable time, and keeps delivering if any single replica fails.',
    ],
    requirements: [
      'Accept at least 99.9% of the 3,000 rps burst (writes only, 60 seconds) and lose no messages.',
      'Every message must be stored in the database through a service tier.',
      'The backlog must drain within the published time after the burst, including when one replica fails during a 1,000 rps stream.',
    ],
    scenarios: [
      { id: 'burst', label: 'Campaign burst', workload: { rps: 3000, readRatio: 0, durationSec: 60 } },
      { id: 'failure', label: 'One replica fails', workload: { rps: 1000, readRatio: 0, durationSec: 60 }, failure: true },
    ],
    criteria: [
      {
        id: 'burst-served', label: 'Accepted during the burst', category: 'reliability', metric: 'servedPct', scenarioId: 'burst',
        better: 'higher', tiers: [99.9, 99.9, 99.9], best: 100, worst: 50, weight: 1, unit: '%',
        hint: 'The ingest tier must absorb the burst even though the database cannot.',
      },
      {
        id: 'burst-lost', label: 'Messages lost in the burst', category: 'delivery', metric: 'lostMessages', scenarioId: 'burst',
        better: 'lower', tiers: [0, 0, 0], best: 0, worst: 100000, weight: 1, unit: 'messages',
        hint: 'The queue overflows when the backlog exceeds its limit; use a bigger queue or drain faster.',
      },
      {
        id: 'burst-drain', label: 'Time to drain the backlog', category: 'delivery', metric: 'drainSeconds', scenarioId: 'burst',
        better: 'lower', tiers: [900, 320, 100], best: 60, worst: 900, weight: 2, unit: 's',
        hint: 'Draining is limited by the slowest consumer, usually database writes on the primary.',
      },
      {
        id: 'burst-ack', label: 'Acknowledgement latency', category: 'latency', metric: 'tailLatencyMs', scenarioId: 'burst',
        better: 'lower', tiers: [450, 150, 100], best: 40, worst: 450, weight: 1, unit: 'ms',
        hint: 'Callers wait only for the ingest tier and the queue; keep the ingest tier below full utilization.',
      },
      {
        id: 'failure-served', label: 'Accepted during a failure', category: 'reliability', metric: 'servedPct', scenarioId: 'failure',
        better: 'higher', tiers: [99.9, 99.9, 99.9], best: 100, worst: 50, weight: 1, unit: '%',
        hint: 'Every tier that handles the stream needs a spare replica.',
      },
      {
        id: 'failure-drain', label: 'Drain time after a failure', category: 'delivery', metric: 'drainSeconds', scenarioId: 'failure',
        better: 'lower', tiers: [600, 300, 60], best: 0, worst: 600, weight: 1.5, unit: 's',
        hint: 'If a consumer or the database has one replica, its failure stops delivery entirely.',
      },
      {
        id: 'cost', label: 'Monthly cost', category: 'cost', metric: 'costUsd',
        better: 'lower', tiers: [2400, 2200, 2000], best: 800, worst: 2600, weight: 1.5, unit: 'USD',
        hint: 'Spend on the bottleneck (usually the database) rather than on every tier.',
      },
    ],
    primaryScenarioId: 'burst',
    failureScenarioId: 'failure',
    requiredOnEveryPath: ['service'],
    maxComponents: 12,
    starter: starter(),
  },
];

export function getChallenge(id: string): ChallengeDef | undefined {
  return CHALLENGES.find((c) => c.id === id);
}
