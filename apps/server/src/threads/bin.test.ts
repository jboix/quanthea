import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@quanthea/shared';
import { eventsSpec } from '../dashboards/test/events-spec.ts';
import type { AppError } from '../lib/errors.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * A thread with a dashboard, and some usage recorded against both.
 *
 * @returns The thread and its dashboard.
 */
function threadWithDashboard() {
  const thread = services.threads.create('editor-1');
  const dashboard = services.dashboards.create(eventsSpec(), 'first', 'editor-1');
  services.threads.attachDashboard(thread.id, dashboard.id, 'Events');
  const tokens = { input: 1000, cachedInput: 0, cacheWrite: 0, output: 100 };
  services.usage.recordStep({
    threadId: thread.id,
    provider: 'p',
    vendor: 'openai',
    model: 'm',
    job: 'build',
    feature: 'building',
    tokens,
  });
  services.usage.recordPinnedView(dashboard.id);
  return { threadId: thread.id, dashboardId: dashboard.id };
}

/**
 * An alert thread whose alert has a first version, over the in-memory events.
 *
 * @returns The thread and its alert.
 */
function threadWithAlert() {
  const thread = services.threads.create('editor-1', undefined, undefined, { kind: 'alert' });
  const spec = {
    specVersion: 1,
    title: 'Errors by service',
    query: { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT * FROM events' },
    value: { field: 'errors', by: ['service'], reduce: 'max' },
    condition: { kind: 'threshold', op: 'above', value: 4, for: '5m' },
    every: '1m',
    lookback: '10m',
    severity: 'warning',
    message: { title: '{alert}', body: '{series} at {value}.' },
  };
  const { alertId } = services.alerts.saveVersion({ spec, threadId: thread.id }, 'editor-1');
  return { threadId: thread.id, alertId };
}

/**
 * The error a call throws.
 *
 * @param call - The call.
 * @returns The error.
 */
function failureOf(call: () => unknown): AppError {
  try {
    call();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('It did not throw.');
}

describe('the bin of threads', () => {
  test('takes a thread out of reach, lists it, and restores it', () => {
    const { threadId, dashboardId } = threadWithDashboard();
    services.bin.bin(threadId, 'editor-1');
    expect(services.threads.list()).toEqual([]);
    expect(failureOf(() => services.threads.get(threadId)).code).toBe('not_found');
    expect(services.bin.list()).toMatchObject([
      { id: threadId, dashboardId, dashboardTitle: 'Events', deletedBy: 'editor-1' },
    ]);
    expect(services.bin.ownerOf(dashboardId)).toEqual({
      threadId,
      binned: true,
      ownerId: 'editor-1',
    });
    services.bin.restore(threadId, 'editor-1');
    expect(services.threads.get(threadId).dashboardId).toBe(dashboardId);
    expect(services.bin.list()).toEqual([]);
  });

  test('refuses a thread whose dashboard is pinned', async () => {
    const { threadId, dashboardId } = threadWithDashboard();
    await services.dashboards.pin(dashboardId, 1, 'editor-1');
    expect(failureOf(() => services.bin.bin(threadId, 'editor-1')).message).toBe(
      'Its dashboard is pinned. Unpin it before deleting.',
    );
    services.dashboards.unpin(dashboardId, 'editor-1');
    services.bin.bin(threadId, 'editor-1');
    expect(services.bin.list()).toHaveLength(1);
  });

  test('refuses a thread whose alert is active, and takes it once the alert is deactivated', async () => {
    const { threadId, alertId } = threadWithAlert();
    await services.alerts.activate(alertId, 1, 'editor-1');
    expect(services.threads.get(threadId).alertActive).toBe(true);
    expect(failureOf(() => services.bin.bin(threadId, 'editor-1')).message).toBe(
      'Its alert is active. Deactivate it before deleting.',
    );
    await services.alerts.deactivate(alertId, 'editor-1');
    expect(services.threads.get(threadId).alertActive).toBe(false);
    services.bin.bin(threadId, 'editor-1');
    expect(services.bin.list().map((thread) => thread.id)).toEqual([threadId]);
  });

  test('binning drafts leaves a thread whose alert is active, and takes it once deactivated', async () => {
    const { threadId, alertId } = threadWithAlert();
    await services.alerts.activate(alertId, 1, 'editor-1');
    expect(services.bin.binDrafts('editor-1', 'editor-1')).toBe(0);
    await services.alerts.deactivate(alertId, 'editor-1');
    expect(services.bin.binDrafts('editor-1', 'editor-1')).toBe(1);
    expect(services.bin.list().map((thread) => thread.id)).toEqual([threadId]);
  });

  test('purging a thread keeps its alert and every version of it', async () => {
    const { threadId, alertId } = threadWithAlert();
    services.alerts.saveVersion(
      { alertId, spec: services.alerts.get(alertId, 'editor').versions[0]?.spec },
      'editor-1',
    );
    services.bin.bin(threadId, 'editor-1');
    services.bin.purge(threadId, 'admin-1');
    const alert = services.alerts.get(alertId, 'editor');
    expect(alert.versions.map((version) => version.version)).toEqual([2, 1]);
  });

  test('purges the thread and its dashboard, and keeps the usage', () => {
    const { threadId, dashboardId } = threadWithDashboard();
    const before = services.usage.report(1).buckets;
    services.bin.bin(threadId, 'editor-1');
    services.bin.purge(threadId, 'admin-1');
    expect(services.bin.list()).toEqual([]);
    expect(failureOf(() => services.dashboards.get(dashboardId, 'editor')).code).toBe('not_found');
    expect(services.bin.ownerOf(dashboardId)).toBeNull();
    expect(services.usage.report(1).buckets).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
    expect(failureOf(() => services.bin.purge(threadId, 'admin-1')).code).toBe('not_found');
  });

  test('purges only threads in the bin, all of them or those binned before a time', () => {
    const first = threadWithDashboard();
    const second = threadWithDashboard();
    const live = threadWithDashboard();
    services.bin.bin(first.threadId, 'editor-1');
    const cutoff = Date.now() + 1;
    expect(services.bin.purgeAll('retention', cutoff - 60_000)).toBe(0);
    services.bin.bin(second.threadId, 'editor-1');
    expect(services.bin.purgeAll('admin-1')).toBe(2);
    expect(services.threads.list().map((thread) => thread.id)).toEqual([live.threadId]);
  });
});
