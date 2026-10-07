import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type Principal, type SourceAccess } from '@quanthea/shared';
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
import { mountConnectorRoutes } from './connector-routes.ts';
import { mountThreadEndpoints } from './thread-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testServices>>;
let connectorId = '';

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  const parsed = connectorInputSchema.parse({ ...input, accessLevel: 3 });
  ({ id: connectorId } = await fixture.connections.create(parsed, 'admin-1'));
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the thread and connector routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountThreadEndpoints(app, fixture);
  mountConnectorRoutes(app, fixture.connections, fixture.managed, fixture.threads);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const init = body === undefined ? { method } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

/**
 * A thread of the editor whose answer read the connector at a level.
 *
 * @param level - The level the answer read it at.
 * @returns The thread id.
 */
function threadReadAt(level: SourceAccess['level']): string {
  const { id } = fixture.threads.create(editor.id);
  const access: SourceAccess = { connectorId, level, hidden: [] };
  const answer = { id: `a-${id}`, role: 'assistant' as const, parts: [] as unknown[] };
  answer.parts.push(
    { type: 'text', text: 'Read it.' },
    { type: 'data-sourceAccess', data: access },
  );
  const question = { id: `q-${id}`, role: 'user' as const, parts: [{ type: 'text', text: 'Hi' }] };
  fixture.threads.saveMessages(id, [question, answer] as never, editor.id);
  return id;
}

describe('an access change', () => {
  test('is counted before it is saved, by admins only, in the threads it restricts', async () => {
    threadReadAt(3);
    threadReadAt(2);
    const path = `/api/connectors/${connectorId}/affected-threads`;
    const count = (body: unknown) => client(admin)('POST', path, body);
    expect((await count({ accessLevel: 1, hiddenFields: [] })).body).toEqual({ threads: 2 });
    expect((await count({ accessLevel: 2, hiddenFields: [] })).body).toEqual({ threads: 1 });
    expect((await count({ accessLevel: 3, hiddenFields: [] })).body).toEqual({ threads: 0 });
    expect((await count({ accessLevel: 3, hiddenFields: ['events.service'] })).body).toEqual({
      threads: 2,
    });
    const refused = await client(editor)('POST', path, { accessLevel: 1, hiddenFields: [] });
    expect(refused.status).toBe(403);
    expect(fixture.connections.list()[0]?.accessLevel).toBe(3);
  });

  test('flags the threads holding data it restricts, in the list and the thread', async () => {
    const before = threadReadAt(3);
    const after = threadReadAt(2);
    const call = client(editor);
    const flags = async () => {
      const list = (await call('GET', '/api/threads')).body as unknown as Record<string, unknown>[];
      return Object.fromEntries(list.map((thread) => [thread.id, thread.restrictedData]));
    };
    expect(await flags()).toEqual({ [before]: false, [after]: false });
    await fixture.connections.update(connectorId, { accessLevel: 2 }, admin.id);
    expect(await flags()).toEqual({ [before]: true, [after]: false });
    expect((await call('GET', `/api/threads/${before}`)).body.restrictedData).toBe(true);
    expect((await call('GET', `/api/threads/${after}`)).body.restrictedData).toBe(false);
  });

  test('stops flagging a thread once its connector is gone', async () => {
    const thread = threadReadAt(3);
    await fixture.connections.update(connectorId, { accessLevel: 1 }, admin.id);
    await fixture.connections.remove(connectorId, admin.id);
    expect((await client(editor)('GET', `/api/threads/${thread}`)).body.restrictedData).toBe(false);
  });
});
