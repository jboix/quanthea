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
const analyst: Principal = { id: 'analyst-1', name: 'Anna', role: 'analyst' };

/** The names the fake users service knows. */
const names: Readonly<Record<string, string>> = { 'editor-1': 'Eddie', 'admin-1': 'Ada' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let views: string[];
let now: number;

beforeEach(async () => {
  dataDir = temporaryDir();
  now = Date.parse('2026-09-26T15:00:00Z');
  fixture = await testServices(dataDir.path, undefined, () => now);
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

  test('editors list a dashboard’s snapshots and revoke any', async () => {
    const id = await eventsDashboard(true);
    const taken = await client(admin)('POST', '/api/snapshots', take(id));
    const { id: snapshotId } = snapshotSummarySchema.parse(taken.body);
    expect((await client(viewer)('GET', `/api/dashboards/${id}/snapshots`)).status).toBe(403);
    const listed = await client(otherEditor)('GET', `/api/dashboards/${id}/snapshots`);
    expect(listed.body).toMatchObject({ snapshots: [{ id: snapshotId, takenBy: 'Ada' }] });
    expect((await client(viewer)('DELETE', `/api/snapshots/${snapshotId}`)).status).toBe(403);
    expect((await client(analyst)('DELETE', `/api/snapshots/${snapshotId}`)).status).toBe(403);
    expect((await client(otherEditor)('DELETE', `/api/snapshots/${snapshotId}`)).status).toBe(200);
    expect(await libraryIds(viewer)).toEqual([]);
    const gone = await client(viewer)('GET', `/api/snapshots/${snapshotId}`);
    const unknown = await client(viewer)('GET', '/api/snapshots/AAAAAAAAAAAAAAAAAAAAAA');
    expect([gone.status, unknown.status]).toEqual([404, 404]);
    expect(apiErrorBodySchema.parse(gone.body).error.message).toBe(
      apiErrorBodySchema.parse(unknown.body).error.message,
    );
  });
});

/**
 * The ids the Library's snapshot list gives someone.
 *
 * @param principal - Who asks.
 * @param query - The query string, if any.
 * @returns The ids, the newest first.
 */
async function libraryIds(principal: Principal, query = ''): Promise<string[]> {
  const listed = await client(principal)('GET', `/api/snapshots${query}`);
  expect(listed.status).toBe(200);
  const { snapshots } = listed.body as { snapshots: { id: string }[] };
  return snapshots.map((snapshot) => snapshot.id);
}

/**
 * Takes a snapshot as someone and returns its id.
 *
 * @param principal - Who takes it.
 * @param body - The request.
 * @returns The id.
 */
async function taken(principal: Principal, body: object): Promise<string> {
  const response = await client(principal)('POST', '/api/snapshots', body);
  now += 60_000;
  return snapshotSummarySchema.parse(response.body).id;
}

describe('the Library’s snapshots', () => {
  test('a pinned version’s snapshot is listed for every role; a draft’s for its owner and admins', async () => {
    const pinned = await eventsDashboard(true);
    const draft = await eventsDashboard(false);
    const thread = fixture.threads.create('editor-1');
    fixture.threads.attachDashboard(thread.id, draft, 'Events');
    const shown = await taken(admin, take(pinned));
    const drafted = await taken(editor, take(draft));
    for (const principal of [viewer, analyst, otherEditor])
      expect(await libraryIds(principal)).toEqual([shown]);
    expect(await libraryIds(editor)).toEqual([drafted, shown]);
    expect(await libraryIds(admin)).toEqual([drafted, shown]);
  });

  test('it searches the title, the taker and the period, filters and pages', async () => {
    const id = await eventsDashboard(true);
    const day = await taken(editor, take(id));
    const kept = await taken(admin, { ...take(id), lifetime: 'forever' });
    expect(await libraryIds(viewer, '?q=eddie')).toEqual([day]);
    expect(await libraryIds(viewer, '?q=events%20v1')).toEqual([kept, day]);
    expect(await libraryIds(viewer, '?q=nothing')).toEqual([]);
    // The first ran over 14:00 to 15:00 UTC, the second a minute later.
    expect(await libraryIds(viewer, '?q=26%20sep%2014:00&timeZone=UTC')).toEqual([day]);
    expect(await libraryIds(viewer, '?q=16:01&timeZone=Europe/Zurich')).toEqual([kept]);
    expect(await libraryIds(viewer, '?filter=kept')).toEqual([kept]);
    expect(await libraryIds(viewer, '?filter=expiring')).toEqual([day]);
    const page = await client(viewer)('GET', '/api/snapshots?limit=1&offset=1');
    expect(page.body).toMatchObject({ snapshots: [{ id: day, takenBy: 'Eddie' }], total: 2 });
    expect((await client(viewer)('GET', '/api/snapshots?timeZone=Mars/Base')).status).toBe(400);
  });

  test('an expired snapshot is not listed', async () => {
    const id = await eventsDashboard(true);
    const day = await taken(editor, take(id));
    const kept = await taken(editor, { ...take(id), lifetime: 'forever' });
    expect(await libraryIds(viewer)).toEqual([kept, day]);
    now += 2 * 86_400_000;
    expect(await libraryIds(viewer)).toEqual([kept]);
  });
});
