import { graphOf } from '../model/builder.ts';
import type { Graph, NodeConfig } from '../model/types.ts';

/**
 * Checked reference designs used to calibrate and test the star thresholds. They are only imported
 * by tests, so they never ship in the app bundle.
 */

const readPath = (cdn: boolean, lb: number, service: NodeConfig, cache: NodeConfig | null, db: NodeConfig): Graph => {
  const seeds: Parameters<typeof graphOf>[0] = [['clients', 'client', 'Users']];
  const links: [string, string][] = [];
  let prev = 'clients';
  const add = (id: string, kind: 'cdn' | 'loadBalancer' | 'service' | 'cache' | 'database', name: string, config?: NodeConfig) => {
    seeds.push([id, kind, name, config]);
    links.push([prev, id]);
    prev = id;
  };
  if (cdn) add('cdn', 'cdn', 'CDN');
  add('lb', 'loadBalancer', 'Load balancer', { replicas: lb });
  add('api', 'service', 'API', service);
  if (cache) add('cache', 'cache', 'Cache', cache);
  add('db', 'database', 'Database', db);
  return graphOf(seeds, links);
};

const notification = (api: NodeConfig, queue: NodeConfig, worker: NodeConfig, db: NodeConfig): Graph =>
  graphOf(
    [
      ['clients', 'client', 'Campaign'],
      ['api', 'service', 'Ingest API', api],
      ['queue', 'queue', 'Queue', queue],
      ['worker', 'service', 'Workers', worker],
      ['db', 'database', 'Database', db],
    ],
    [['clients', 'api'], ['api', 'queue'], ['queue', 'worker'], ['worker', 'db']],
  );

export const REFERENCES = {
  'read-heavy-api': {
    three: readPath(true, 1, { size: 'large', replicas: 3 }, { size: 'small', replicas: 2 }, { size: 'medium' }),
    threeAlt: readPath(true, 2, { size: 'large', replicas: 3 }, { size: 'small', replicas: 2 }, { size: 'medium' }),
    two: readPath(true, 2, { size: 'medium', replicas: 5 }, { size: 'small', replicas: 2 }, { size: 'large' }),
    one: readPath(false, 1, { size: 'medium', replicas: 9 }, { size: 'medium' }, { size: 'medium' }),
    fail: readPath(false, 1, { size: 'medium', replicas: 8 }, { size: 'medium' }, { size: 'medium' }),
  },
  'highly-available-api': {
    three: readPath(false, 2, { size: 'medium', replicas: 5 }, { size: 'small', replicas: 2 }, { size: 'medium', replicas: 2 }),
    two: readPath(false, 2, { size: 'large', replicas: 3 }, { size: 'small', replicas: 2 }, { size: 'medium', replicas: 2 }),
    one: readPath(false, 2, { size: 'medium', replicas: 4 }, { size: 'small', replicas: 2 }, { size: 'medium', replicas: 2 }),
    fail: readPath(false, 1, { size: 'medium', replicas: 3 }, null, { size: 'medium' }),
  },
  'bursty-notifications': {
    three: notification({ size: 'medium', replicas: 4 }, { size: 'small' }, { size: 'small', replicas: 3 }, { size: 'large', replicas: 2 }),
    two: notification({ size: 'medium', replicas: 4 }, { size: 'small' }, { size: 'small', replicas: 2 }, { size: 'medium', replicas: 2 }),
    one: notification({ size: 'medium', replicas: 4 }, { size: 'small' }, { size: 'small', replicas: 2 }, { size: 'small', replicas: 2 }),
    fail: graphOf(
      [
        ['clients', 'client', 'Campaign'],
        ['api', 'service', 'API', { size: 'medium', replicas: 4 }],
        ['db', 'database', 'Database', { size: 'medium', replicas: 2 }],
      ],
      [['clients', 'api'], ['api', 'db']],
    ),
  },
} as const;
