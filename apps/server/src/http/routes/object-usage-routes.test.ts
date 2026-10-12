import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type Principal } from '@quanthea/shared';
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
import { mountConnectorRoutes } from './connector-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let connectorId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  const created = await fixture.connections.create(connectorInputSchema.parse(input), 'admin-1');
  connectorId = created.id;
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * Counts the dashboards a visibility would hide an object from, as a principal.
 *
 * @param principal - Who asks.
 * @param visibility - The visibility about to be saved.
 * @returns The status and the body.
 */
async function count(principal: Principal, visibility: unknown) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountConnectorRoutes(app, fixture.connections, fixture.managed, fixture);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  const response = await app.request(`/api/connectors/${connectorId}/object-usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' },
    body: JSON.stringify(visibility),
  });
  return { status: response.status, body: await response.json() };
}

/**
 * A thread of the editor with a draft dashboard over the events table.
 *
 * @returns The thread and the dashboard.
 */
function threadWithDraft() {
  const thread = fixture.threads.create(editor.id);
  const dashboard = fixture.dashboards.create(eventsSpec(), 'first', editor.id);
  fixture.threads.attachDashboard(thread.id, dashboard.id, 'Events');
  return { threadId: thread.id, dashboardId: dashboard.id };
}

const hideEvents = { showSystem: false, mode: 'except', names: ['events'] };

describe('hiding an object of a connector', () => {
  test('is counted first, in the threads and pinned dashboards that read it', async () => {
    const { dashboardId } = threadWithDraft();
    threadWithDraft();
    await fixture.dashboards.pin(dashboardId, 1, editor.id);
    expect((await count(admin, hideEvents)).body).toEqual({ threads: 2, pinned: 1 });
    const pattern = { showSystem: false, mode: 'only', names: ['ev*'] };
    expect((await count(admin, pattern)).body).toEqual({ threads: 0, pinned: 0 });
    const others = { showSystem: false, mode: 'only', names: ['orders'] };
    expect((await count(admin, others)).body).toEqual({ threads: 2, pinned: 1 });
    expect((await fixture.connections.get(connectorId)).visibility.names).toEqual([]);
  });

  test('counts the latest draft of a thread, and no thread in the bin', async () => {
    const { threadId, dashboardId } = threadWithDraft();
    expect((await count(admin, hideEvents)).body).toEqual({ threads: 1, pinned: 0 });
    fixture.dashboards.addVersion(dashboardId, { ...eventsSpec(), title: 'Again' }, 'again', 'e');
    expect((await count(admin, hideEvents)).body).toEqual({ threads: 1, pinned: 0 });
    fixture.bin.bin(threadId, editor.id);
    expect((await count(admin, hideEvents)).body).toEqual({ threads: 0, pinned: 0 });
  });

  test('is for admins, and for a connector that exists', async () => {
    expect((await count(editor, hideEvents)).status).toBe(403);
    connectorId = 'nope';
    expect((await count(admin, hideEvents)).status).toBe(404);
  });
});
