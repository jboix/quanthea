import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Principal } from '@querent/shared';
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
import { mountBinEndpoints } from './bin-routes.ts';

const admin: Principal = { id: 'admin-1', name: 'Ada', role: 'admin' };
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
 * An app with the bin routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountBinEndpoints(app, fixture);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'querent' };
    const init =
      body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

describe('bin routes', () => {
  test('let admins set how long threads stay in the bin, 30 days by default', async () => {
    expect((await client(editor)('GET', '/api/settings/retention')).status).toBe(403);
    expect((await client(admin)('GET', '/api/settings/retention')).body).toEqual({ binDays: 30 });
    const saved = await client(admin)('PUT', '/api/settings/retention', { binDays: null });
    expect(saved.body).toEqual({ binDays: null });
    expect((await client(editor)('GET', '/api/bin')).body).toEqual({ threads: [], binDays: null });
    expect((await client(admin)('PUT', '/api/settings/retention', { binDays: -1 })).status).toBe(
      400,
    );
  });

  test('let editors list and restore, and only admins delete for good', async () => {
    const first = fixture.threads.create('editor-1');
    const second = fixture.threads.create('editor-1');
    fixture.bin.bin(first.id, 'editor-1');
    fixture.bin.bin(second.id, 'editor-1');
    expect((await client(viewer)('GET', '/api/bin')).status).toBe(403);
    expect((await client(editor)('GET', '/api/bin')).body).toMatchObject({
      threads: [{ id: second.id }, { id: first.id }],
    });
    expect((await client(editor)('DELETE', `/api/bin/${first.id}`)).status).toBe(403);
    expect((await client(editor)('POST', `/api/bin/${first.id}/restore`)).status).toBe(200);
    expect((await client(admin)('DELETE', `/api/bin/${first.id}`)).status).toBe(404);
    expect((await client(admin)('DELETE', '/api/bin')).body).toEqual({ purged: 1 });
  });
});
