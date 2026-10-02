import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@quanthea/shared';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createDashboardRepository } from '../db/dashboard-repository.ts';
import { createSnapshotRepository } from '../db/snapshot-repository.ts';
import type { AppError } from '../lib/errors.ts';
import { createQueryExecutor } from '../query/executor.ts';
import { createResultCache } from '../query/result-cache.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createSnapshots, type SnapshotRequest } from './snapshots.ts';
import { eventsSpec } from './test/events-spec.ts';

const dayMs = 86_400_000;

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let now: number;
let queries: number;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: { rowCount: 5 }, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  now = Date.parse('2026-09-30T14:00:00Z');
  queries = 0;
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * The snapshots service over the test database, with a clock the test moves and an executor that
 * counts every query it runs.
 *
 * @param maxBytes - The size cap, if not the default.
 * @returns The service.
 */
function snapshots(maxBytes?: number) {
  const executor = createQueryExecutor(createResultCache({ ttlMs: 0, maxEntries: 1 }));
  return createSnapshots({
    repository: createDashboardRepository(services.database),
    audit: createAuditRepository(services.database),
    lookup: services.connections.lookup,
    openSource: async (name) => (await services.connections.open(name)).source,
    executor: {
      run: (source, request) => {
        queries += 1;
        return executor.run(source, request);
      },
    },
    snapshots: createSnapshotRepository(services.database),
    now: () => now,
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
}

/**
 * Creates the events dashboard and pins its first version.
 *
 * @returns The dashboard id.
 */
async function pinnedEvents(): Promise<string> {
  const { id } = services.dashboards.create(eventsSpec(), 'imported', 'editor-1');
  await services.dashboards.pin(id, 1, 'editor-1');
  return id;
}

/**
 * A request for a snapshot of the first version over the last hour.
 *
 * @param dashboardId - The dashboard.
 * @param extra - What to change.
 * @returns The request.
 */
function request(dashboardId: string, extra: Partial<SnapshotRequest> = {}): SnapshotRequest {
  return {
    dashboardId,
    version: 1,
    variables: { env: 'staging' },
    time: { from: 'now-1h', to: 'now' },
    hiddenMarkers: ['events', 'nothing'],
    lifetime: '7d',
    ...extra,
  };
}

/**
 * Awaits a call and returns the AppError it failed with.
 *
 * @param call - The call.
 * @returns The error.
 */
async function failureOf(call: () => unknown): Promise<AppError> {
  try {
    await call();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('Expected the call to fail.');
}

describe('taking a snapshot', () => {
  test('runs every panel here, over the range resolved to absolute times', async () => {
    const id = await pinnedEvents();
    const taken = await snapshots().take(request(id), 'editor', 'editor-1');
    expect(queries).toBeGreaterThanOrEqual(4);
    expect(taken).toMatchObject({
      dashboardId: id,
      version: 1,
      title: 'Events',
      time: { from: now - 3_600_000, to: now },
      variables: { env: 'staging', service: '$__all', order: 'A-1' },
      hiddenMarkers: ['events'],
      takerId: 'editor-1',
      takenAt: now,
      expiresAt: now + 7 * dayMs,
    });
    expect(taken.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(taken.bytes).toBeGreaterThan(0);
  });

  test('refuses a version the role may not see, and choices the spec refuses', async () => {
    const { id } = services.dashboards.create(eventsSpec(), 'imported', 'editor-1');
    const service = snapshots();
    expect((await failureOf(() => service.take(request(id), 'viewer', 'v-1'))).code).toBe(
      'not_found',
    );
    const wrong = request(id, { variables: { env: 'nowhere' } });
    expect((await failureOf(() => service.take(wrong, 'editor', 'e-1'))).code).toBe('bad_request');
    expect(service.list()).toEqual([]);
  });

  test('takes a draft for those who may see it', async () => {
    const { id } = services.dashboards.create(eventsSpec(), 'imported', 'editor-1');
    const taken = await snapshots().take(request(id), 'editor', 'editor-1');
    expect(taken.version).toBe(1);
  });

  test('refuses a snapshot over the size cap, and stores nothing', async () => {
    const id = await pinnedEvents();
    const service = snapshots(1000);
    const failure = await failureOf(() => service.take(request(id), 'editor', 'editor-1'));
    expect(failure.code).toBe('bad_request');
    expect(failure.message).toContain('a snapshot holds at most 0.0 MB');
    expect(service.list()).toEqual([]);
  });
});

describe('opening a snapshot', () => {
  test('gives back the frozen runs and runs no query', async () => {
    const id = await pinnedEvents();
    const service = snapshots();
    const taken = await service.take(request(id), 'editor', 'editor-1');
    queries = 0;
    now += 2 * dayMs;
    const opened = service.open(taken.id);
    expect(queries).toBe(0);
    expect(opened.spec.title).toBe('Events');
    expect(Object.keys(opened.panels)).toEqual(['errors-peak', 'errors-over-time']);
    const chart = opened.panels['errors-over-time'];
    expect(chart?.time).toEqual(taken.time);
    expect(chart?.queries[0]?.frames[0]?.values[0]?.[0]).toBe(taken.time.from);
    expect(chart?.markers.map((marker) => marker.annotation)).toEqual(['events']);
  });

  test('says "not found" alike for an unknown, an expired and a revoked snapshot', async () => {
    const id = await pinnedEvents();
    const service = snapshots();
    const day = await service.take(request(id, { lifetime: '1d' }), 'editor', 'editor-1');
    const kept = await service.take(request(id, { lifetime: 'forever' }), 'editor', 'editor-1');
    service.revoke(kept.id, 'admin-1');
    now += dayMs;
    const messages = await Promise.all(
      ['unknown', day.id, kept.id].map(async (each) => {
        const failure = await failureOf(() => service.open(each));
        return [failure.code, failure.message];
      }),
    );
    expect(new Set(messages.map(String)).size).toBe(1);
    expect(messages[0]?.[0]).toBe('not_found');
    expect((await failureOf(() => service.revoke(day.id, 'admin-1'))).code).toBe('not_found');
  });
});

describe('lifetimes', () => {
  test('lists live snapshots, newest first, and the purge deletes expired ones', async () => {
    const id = await pinnedEvents();
    const service = snapshots();
    const day = await service.take(request(id, { lifetime: '1d' }), 'editor', 'editor-1');
    now += 1;
    const month = await service.take(request(id, { lifetime: '30d' }), 'editor', 'editor-2');
    now += 1;
    const forever = await service.take(request(id, { lifetime: 'forever' }), 'editor', 'e-3');
    expect(forever.expiresAt).toBeNull();
    expect(service.list(id).map((each) => each.id)).toEqual([forever.id, month.id, day.id]);
    expect(service.list('another')).toEqual([]);
    now += dayMs;
    expect(service.list().map((each) => each.id)).toEqual([forever.id, month.id]);
    expect(service.purgeExpired()).toBe(1);
    now += 30 * dayMs;
    expect(service.purgeExpired()).toBe(1);
    expect(service.list().map((each) => each.id)).toEqual([forever.id]);
  });

  test('a snapshot outlives the bin, and goes when its thread is purged for good', async () => {
    const thread = services.threads.create('editor-1');
    const { id } = services.dashboards.create(eventsSpec(), 'imported', 'editor-1');
    services.threads.attachDashboard(thread.id, id, 'Events');
    const service = snapshots();
    const taken = await service.take(request(id), 'editor', 'editor-1');
    services.bin.bin(thread.id, 'editor-1');
    expect(service.open(taken.id).dashboardId).toBe(id);
    services.bin.purge(thread.id, 'admin-1');
    expect((await failureOf(() => service.open(taken.id))).code).toBe('not_found');
  });
});
