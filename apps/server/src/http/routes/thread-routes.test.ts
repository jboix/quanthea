import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type Principal, threadSummarySchema } from '@quanthea/shared';
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
import { mountThreadEndpoints } from './thread-routes.ts';

const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };
const viewer: Principal = { id: 'viewer-1', name: 'Vera', role: 'viewer' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the thread routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountThreadEndpoints(app, fixture);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'querent' };
    const init = body === undefined ? { method } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

const plan = {
  title: 'Checkout',
  variables: [],
  panels: [
    { kind: 'stat' as const, title: 'Errors', language: 'sql' as const, connector: 'events' },
  ],
};

describe('thread routes', () => {
  test('are for editors', async () => {
    expect((await client(viewer)('GET', '/api/threads')).status).toBe(403);
    expect((await client(viewer)('POST', '/api/threads', {})).status).toBe(403);
  });

  test('create a thread, approve its plan, and refuse Undo before a dashboard exists', async () => {
    const call = client(editor);
    const { id } = threadSummarySchema.parse((await call('POST', '/api/threads', {})).body);
    const proposed = fixture.threads.proposePlan(id, plan, false);
    const approved = await call('POST', `/api/threads/${id}/plans/${proposed.id}/approve`);
    expect(threadSummarySchema.parse(approved.body).state).toBe('building');
    expect((await call('POST', `/api/threads/${id}/plans/${proposed.id}/reject`)).status).toBe(400);
    expect((await call('POST', `/api/threads/${id}/restore`, { version: 1 })).status).toBe(400);
    expect((await call('GET', '/api/threads')).body).toMatchObject([{ id, state: 'building' }]);
    expect((await call('DELETE', `/api/threads/${id}`)).body).toEqual({ binned: true });
    expect((await call('GET', `/api/threads/${id}`)).status).toBe(404);
  });

  test('start a thread on a provider, and refuse one that does not exist', async () => {
    const call = client(editor);
    const created = await call('POST', '/api/threads', { providerId: 'anthropic' });
    expect(threadSummarySchema.parse(created.body).providerId).toBe('anthropic');
    const unknown = await call('POST', '/api/threads', { providerId: 'nope' });
    expect(unknown.status).toBe(400);
  });

  test('start a draft from a pinned dashboard, once, with no model', async () => {
    const events = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
    await fixture.connections.create(connectorInputSchema.parse(events), 'admin-1');
    const pinned = fixture.dashboards.create(eventsSpec(), 'first', 'editor-1');
    await fixture.dashboards.pin(pinned.id, 1, 'editor-1');
    const call = client(editor);
    const { id } = threadSummarySchema.parse((await call('POST', '/api/threads', {})).body);
    fixture.threads.proposePlan(id, plan, false);
    const started = await call('POST', `/api/threads/${id}/start-from`, { dashboardId: pinned.id });
    expect(started.body).toMatchObject({ version: 1 });
    const thread = fixture.threads.get(id);
    expect(thread).toMatchObject({ state: 'ready', title: 'Events' });
    expect(thread.dashboardId).not.toBe(pinned.id);
    expect(thread.plans.map((each) => each.status)).toEqual(['rejected']);
    const again = await call('POST', `/api/threads/${id}/start-from`, { dashboardId: pinned.id });
    expect(again.status).toBe(400);
  });

  test('open a thread on a copy of a dashboard, or on a dashboard without a thread', async () => {
    const events = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
    await fixture.connections.create(connectorInputSchema.parse(events), 'admin-1');
    const source = fixture.dashboards.create(eventsSpec(), 'first', 'editor-1');
    const call = client(editor);
    const path = `/api/dashboards/${source.id}/threads`;
    const copied = await call('POST', path, { mode: 'copy' });
    const copyThread = fixture.threads.get((copied.body as { threadId: string }).threadId);
    expect(copyThread).toMatchObject({ state: 'ready', title: 'Events' });
    expect(fixture.dashboards.get(copyThread.dashboardId ?? '', 'editor')).toMatchObject({
      parentDashboardId: source.id,
      parentVersion: 1,
    });
    const edited = await call('POST', path, { mode: 'edit' });
    const editThread = fixture.threads.get((edited.body as { threadId: string }).threadId);
    expect(editThread.dashboardId).toBe(source.id);
    expect((await call('POST', path, { mode: 'edit' })).status).toBe(400);
    expect((await client(viewer)('POST', path, { mode: 'copy' })).status).toBe(403);
  });

  test('mark the threads whose dashboard has a pinned version', async () => {
    const events = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
    await fixture.connections.create(connectorInputSchema.parse(events), 'admin-1');
    const pinned = fixture.dashboards.create(eventsSpec(), 'first', 'editor-1');
    await fixture.dashboards.pin(pinned.id, 1, 'editor-1');
    const call = client(editor);
    const { id } = threadSummarySchema.parse((await call('POST', '/api/threads', {})).body);
    expect((await call('GET', '/api/threads')).body).toMatchObject([{ id, pinned: false }]);
    fixture.threads.proposePlan(id, plan, false);
    await call('POST', `/api/threads/${id}/start-from`, { dashboardId: pinned.id });
    await fixture.dashboards.pin(fixture.threads.get(id).dashboardId ?? '', 1, 'editor-1');
    expect((await call('GET', '/api/threads')).body).toMatchObject([{ id, pinned: true }]);
  });
});
