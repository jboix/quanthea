import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  apiErrorBodySchema,
  connectorInputSchema,
  dashboardDetailSchema,
  type Principal,
  snapshotSchema,
  snapshotSummarySchema,
} from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { eventsSpec } from '../../dashboards/test/events-spec.ts';
import {
  captureLogs,
  fixedAuthenticator,
  temporaryDir,
  testServices,
} from '../../test/fixtures.ts';
import type { AppEnv } from '../app-env.ts';
import { authenticate } from '../authenticate.ts';
import { handleErrors, handleNotFound } from '../error-handling.ts';
import { mountDashboardEndpoints } from './dashboard-routes.ts';
import { mountSnapshotEndpoints } from './snapshot-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const otherEditor: Principal = { id: 'editor-2', name: 'Olga', role: 'editor' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

/** The names the fake users service knows. */
const names: Readonly<Record<string, string>> = { 'editor-1': 'Eddie', 'admin-1': 'Ada' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let views: string[];

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(connectorInputSchema.parse(input), 'admin-1');
  views = [];
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the dashboard and snapshot routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountDashboardEndpoints(app, fixture.dashboards, { ownerOf: fixture.bin.ownerOf });
  mountSnapshotEndpoints(app, {
    snapshots: fixture.snapshots,
    users: { nameOf: (id) => Promise.resolve(names[id]) },
    ownerOf: fixture.bin.ownerOf,
    onSnapshotView: (dashboardId) => views.push(dashboardId),
  });
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const init = body === undefined ? { method } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

/**
 * Creates the events dashboard as an editor, pinned or as a draft.
 *
 * @param pinned - Whether to pin its first version.
 * @returns The dashboard id.
 */
async function eventsDashboard(pinned: boolean): Promise<string> {
  const asEditor = client(editor);
  const created = await asEditor('POST', '/api/dashboards', { spec: eventsSpec() });
  const { id } = dashboardDetailSchema.parse(created.body);
  if (pinned) await asEditor('POST', `/api/dashboards/${id}/pin`, { version: 1 });
  return id;
}

/**
 * The body of a request for a snapshot of the first version over the last hour.
 *
 * @param dashboardId - The dashboard.
 * @returns The body.
 */
function take(dashboardId: string) {
  return { dashboardId, version: 1, time: { from: 'now-1h', to: 'now' }, lifetime: '1d' };
}

describe('snapshot routes', () => {
  test('editors take; anyone signed in opens it, which counts a view', async () => {
    const id = await eventsDashboard(true);
    expect((await client(viewer)('POST', '/api/snapshots', take(id))).status).toBe(403);
    const taken = await client(editor)('POST', '/api/snapshots', take(id));
    expect(taken.status).toBe(200);
    const summary = snapshotSummarySchema.parse(taken.body);
    expect(summary.takenBy).toBe('Eddie');
    const opened = await client(viewer)('GET', `/api/snapshots/${summary.id}`);
    expect(opened.status).toBe(200);
    const snapshot = snapshotSchema.parse(opened.body);
    expect(snapshot.takenBy).toBe('Eddie');
    expect(snapshot.panels['errors-peak']?.queries[0]?.frames[0]?.meta.rowCount).toBe(5);
    expect(views).toEqual([id]);
  });

  test('a draft is taken only by those who may see it', async () => {
    const id = await eventsDashboard(false);
    const thread = fixture.threads.create('editor-1');
    fixture.threads.attachDashboard(thread.id, id, 'Events');
    expect((await client(otherEditor)('POST', '/api/snapshots', take(id))).status).toBe(404);
    expect((await client(admin)('POST', '/api/snapshots', take(id))).status).toBe(200);
    expect((await client(editor)('POST', '/api/snapshots', take(id))).status).toBe(200);
  });

  test('editors list a dashboard’s snapshots and revoke any; admins list them all', async () => {
    const id = await eventsDashboard(true);
    const taken = await client(admin)('POST', '/api/snapshots', take(id));
    const { id: snapshotId } = snapshotSummarySchema.parse(taken.body);
    expect((await client(viewer)('GET', `/api/dashboards/${id}/snapshots`)).status).toBe(403);
    const listed = await client(otherEditor)('GET', `/api/dashboards/${id}/snapshots`);
    expect(listed.body).toMatchObject({ snapshots: [{ id: snapshotId, takenBy: 'Ada' }] });
    expect((await client(editor)('GET', '/api/snapshots')).status).toBe(403);
    expect((await client(admin)('GET', '/api/snapshots')).body).toMatchObject({
      snapshots: [{ id: snapshotId }],
    });
    expect((await client(viewer)('DELETE', `/api/snapshots/${snapshotId}`)).status).toBe(403);
    expect((await client(otherEditor)('DELETE', `/api/snapshots/${snapshotId}`)).status).toBe(200);
    const gone = await client(viewer)('GET', `/api/snapshots/${snapshotId}`);
    const unknown = await client(viewer)('GET', '/api/snapshots/AAAAAAAAAAAAAAAAAAAAAA');
    expect([gone.status, unknown.status]).toEqual([404, 404]);
    expect(apiErrorBodySchema.parse(gone.body).error.message).toBe(
      apiErrorBodySchema.parse(unknown.body).error.message,
    );
  });
});
