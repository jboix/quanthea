import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type Principal, threadSummarySchema } from '@querent/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
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
    expect((await call('DELETE', `/api/threads/${id}`)).body).toEqual({ deleted: true });
    expect((await call('GET', `/api/threads/${id}`)).status).toBe(404);
  });
});
