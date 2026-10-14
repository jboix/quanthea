import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Principal } from '@quanthea/shared';
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
import { mountDefinitionEndpoints } from './definition-routes.ts';

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
 * An app with the definition routes, acting as a principal.
 *
 * @param principal - Who the requests act as.
 * @returns A function that sends a JSON request and returns the status and body.
 */
function client(principal: Principal) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountDefinitionEndpoints(app, fixture);
  app.onError(handleErrors(captureLogs().logger));
  app.notFound(handleNotFound);
  return async (method: string, path: string, body?: unknown) => {
    const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' };
    const init = body === undefined ? { method } : { method, headers, body: JSON.stringify(body) };
    const response = await app.request(path, init);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

const sessions = { id: 'sessions', name: 'Sessions', meaning: 'One playback, counted once.' };

describe('definition routes', () => {
  test('editors save and delete definitions; every role reads them', async () => {
    const saved = await client(editor)('POST', '/api/definitions', {
      definition: sessions,
      basedOn: null,
    });
    expect(saved.status).toBe(200);
    const listed = await client(viewer)('GET', '/api/definitions');
    expect(JSON.stringify(listed.body)).toContain('One playback');
    const history = await client(viewer)('GET', '/api/definitions/sessions/history');
    expect((history.body.versions as unknown[]).length).toBe(1);
    const deleted = await client(editor)('POST', '/api/definitions/sessions/delete', {
      basedOn: 1,
    });
    expect(deleted.status).toBe(200);
  });

  test('viewers may not save, and a stale save is a conflict', async () => {
    const asViewer = await client(viewer)('POST', '/api/definitions', {
      definition: sessions,
      basedOn: null,
    });
    expect(asViewer.status).toBe(403);
    const asEditor = client(editor);
    await asEditor('POST', '/api/definitions', { definition: sessions, basedOn: null });
    const stale = await asEditor('POST', '/api/definitions', {
      definition: sessions,
      basedOn: null,
    });
    expect(stale.status).toBe(409);
  });
});
