import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  apiErrorBodySchema,
  connectorInputSchema,
  dashboardDetailSchema,
  dashboardPageSchema,
  dashboardVersionSchema,
  type Principal,
  panelRunSchema,
} from '@querent/shared';
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

const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await fixture.connections.create(connectorInputSchema.parse(input), 'admin-1');
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the dashboard routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountDashboardEndpoints(app, fixture.dashboards, () => undefined, fixture.threads.threadOf);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'querent' };
    const init = body === undefined ? { method } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

describe('dashboard routes', () => {
  test('editors create and pin; viewers read the pinned version and run its panels', async () => {
    const asEditor = client(editor);
    const asViewer = client(viewer);
    expect((await asViewer('POST', '/api/dashboards', { spec: eventsSpec() })).status).toBe(403);
    const created = await asEditor('POST', '/api/dashboards', { spec: eventsSpec() });
    expect(created.status).toBe(200);
    const { id } = dashboardDetailSchema.parse(created.body);
    expect((await asViewer('GET', `/api/dashboards/${id}/versions/1`)).status).toBe(404);
    expect((await asViewer('POST', `/api/dashboards/${id}/pin`, { version: 1 })).status).toBe(403);
    expect((await asEditor('POST', `/api/dashboards/${id}/pin`, { version: 1 })).status).toBe(200);
    const version = await asViewer('GET', `/api/dashboards/${id}/versions/1`);
    expect(dashboardVersionSchema.parse(version.body).spec.title).toBe('Events');
    const run = await asViewer('POST', '/api/panels/run', {
      dashboardId: id,
      version: 1,
      panelId: 'errors-peak',
    });
    expect(run.status).toBe(200);
    expect(panelRunSchema.parse(run.body).queries[0]?.frames[0]?.meta.rowCount).toBe(5);
    const options = await asViewer('POST', '/api/variables/options', {
      dashboardId: id,
      version: 1,
      name: 'service',
    });
    expect(options.body).toEqual({ options: ['checkout-svc', 'payments-svc', 'cart-svc'] });
  });

  test('names the thread that edits a dashboard, while the thread exists', async () => {
    const asEditor = client(editor);
    const created = await asEditor('POST', '/api/dashboards', { spec: eventsSpec() });
    const { id } = dashboardDetailSchema.parse(created.body);
    const threadOf = async () =>
      dashboardPageSchema.parse((await asEditor('GET', `/api/dashboards/${id}`)).body).threadId;
    expect(await threadOf()).toBeNull();
    const thread = fixture.threads.create('editor-1');
    fixture.threads.attachDashboard(thread.id, id, 'Events');
    expect(await threadOf()).toBe(thread.id);
    fixture.threads.remove(thread.id, 'editor-1');
    expect(await threadOf()).toBeNull();
  });

  test('returns spec issues as details', async () => {
    const spec = { ...eventsSpec(), panels: [{ id: 'x' }] };
    const refused = await client(editor)('POST', '/api/dashboards', { spec });
    expect(refused.status).toBe(400);
    const { details } = apiErrorBodySchema.parse(refused.body).error;
    expect((details as unknown[])[0]).toMatchObject({ part: 'spec', path: 'panels[0].title' });
  });
});
