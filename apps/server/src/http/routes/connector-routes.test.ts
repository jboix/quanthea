import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Principal } from '@querent/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import {
  captureLogs,
  fixedAuthenticator,
  temporaryDir,
  testConnections,
} from '../../test/fixtures.ts';
import type { AppEnv } from '../app-env.ts';
import { authenticate } from '../authenticate.ts';
import { handleErrors, handleNotFound } from '../error-handling.ts';
import { mountConnectorRoutes } from './connector-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
const editor: Principal = { id: 'editor-1', name: 'Eddie', role: 'editor' };

let dataDir: ReturnType<typeof temporaryDir>;
let fixture: Awaited<ReturnType<typeof testConnections>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  fixture = await testConnections(dataDir.path);
});

afterEach(async () => {
  await fixture.close();
  dataDir.remove();
});

/**
 * An app with the connector routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountConnectorRoutes(app, fixture.connections);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const init =
      body === undefined
        ? { method }
        : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
}

const newConnector = {
  name: 'events',
  kind: 'memory',
  config: { rowCount: 5 },
  secret: { token: 'super-secret-token-value-9f2a' },
};

describe('connector routes', () => {
  test('create, read, list, change, test, read the schema, delete', async () => {
    const call = client(admin);
    const created = await call('POST', '/api/connectors', newConnector);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      name: 'events',
      accessLevel: 2,
      secret: { token: '••••••••9f2a' },
    });
    const id = String(created.body.id);
    expect((await call('GET', '/api/connectors')).body).toHaveLength(1);
    expect((await call('GET', `/api/connectors/${id}`)).body).toMatchObject({
      config: { rowCount: 5 },
    });
    const changed = await call('PATCH', `/api/connectors/${id}`, {
      accessLevel: 1,
      hiddenFields: ['events.service'],
    });
    expect(changed.body).toMatchObject({ accessLevel: 1, hiddenFields: ['events.service'] });
    expect((await call('POST', `/api/connectors/${id}/test`)).body).toMatchObject({
      ok: true,
      readOnly: true,
    });
    const schema = await call('POST', `/api/connectors/${id}/schema`);
    expect(schema.body).toMatchObject({
      entities: [
        {
          name: 'events',
          fields: [{}, { name: 'service', hidden: true, modelSees: 'nothing' }, {}],
        },
      ],
    });
    expect((await call('DELETE', `/api/connectors/${id}`)).body).toEqual({ deleted: true });
    expect((await call('GET', `/api/connectors/${id}`)).status).toBe(404);
  });

  test('lists the kinds with their form schemas', async () => {
    const kinds = await client(admin)('GET', '/api/connector-kinds');
    expect(kinds.body).toMatchObject([{ kind: 'memory', configSchema: { type: 'object' } }]);
  });

  test('answers 400 with the problems, never the secret', async () => {
    const response = await client(admin)('POST', '/api/connectors', {
      ...newConnector,
      config: { rowCount: 'many' },
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'bad_request', details: [{ part: 'config', path: 'rowCount' }] },
    });
    expect(JSON.stringify(response.body)).not.toContain('super-secret');
  });

  test('answers 403 to an editor', async () => {
    const response = await client(editor)('GET', '/api/connectors');
    expect(response.status).toBe(403);
  });
});
