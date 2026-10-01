import { describe, expect, test } from 'bun:test';
import { defineEndpoint, type Principal } from '@quanthea/shared';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { z } from 'zod';
import { captureLogs, fixedAuthenticator } from '../test/fixtures.ts';
import type { AppEnv } from './app-env.ts';
import { authenticate } from './authenticate.ts';
import { mountEndpoint } from './endpoint.ts';
import { handleErrors, handleNotFound } from './error-handling.ts';

const viewer: Principal = { id: 'u1', name: 'Vera', role: 'viewer' };
const editor: Principal = { id: 'u2', name: 'Eddie', role: 'editor' };

const renameEndpoint = defineEndpoint({
  method: 'POST',
  path: '/things/:thingId/rename',
  params: z.object({ thingId: z.string().regex(/^t\d+$/) }),
  query: z.object({ dryRun: z.enum(['true', 'false']).default('false') }),
  body: z.object({ title: z.string().min(1) }),
  output: z.object({ thingId: z.string(), title: z.string(), dryRun: z.boolean() }),
});

/**
 * Builds a bare app with one editor-only endpoint, acting as `principal`.
 *
 * @param principal - Who every request acts as.
 * @param handle - Optional replacement handler.
 * @returns The app and its captured logs.
 */
function buildApp(principal: Principal | null, handle?: () => never) {
  const captured = captureLogs();
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(authenticate(fixedAuthenticator(principal)));
  mountEndpoint(app, renameEndpoint, {
    access: 'editor',
    handle:
      handle ??
      (({ params, query, body }) => ({
        thingId: params.thingId,
        title: body.title,
        dryRun: query.dryRun === 'true',
        secret: 'must not leave the server',
      })),
  });
  app.onError(handleErrors(captured.logger));
  app.notFound(handleNotFound);
  return { app, logs: captured.lines };
}

/**
 * Sends a JSON POST.
 *
 * @param app - The app under test.
 * @param path - The request path.
 * @param body - The raw body text.
 * @returns The response.
 */
function post(app: Hono<AppEnv>, path: string, body: string) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('mountEndpoint', () => {
  test('parses params, query and body, and sends only declared output fields', async () => {
    const { app } = buildApp(editor);
    const response = await post(app, '/api/things/t1/rename?dryRun=true', '{"title":"New"}');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ thingId: 't1', title: 'New', dryRun: true });
  });

  test('answers 401 without a principal', async () => {
    const { app } = buildApp(null);
    const response = await post(app, '/api/things/t1/rename', '{"title":"New"}');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  test('answers 403 when the role is too weak, before reading the input', async () => {
    const { app } = buildApp(viewer);
    const response = await post(app, '/api/things/not-an-id/rename', 'not json');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  test('lists every invalid part in error.details', async () => {
    const { app } = buildApp(editor);
    const response = await post(app, '/api/things/x/rename?dryRun=maybe', '{"title":""}');
    expect(response.status).toBe(400);
    const body = z
      .object({
        error: z.object({
          code: z.string(),
          details: z.array(z.object({ part: z.string(), path: z.string() })),
        }),
      })
      .parse(await response.json());
    expect(body.error.code).toBe('bad_request');
    expect(body.error.details.map((issue) => `${issue.part}:${issue.path}`)).toEqual([
      'params:thingId',
      'query:dryRun',
      'body:title',
    ]);
  });

  test('rejects a body that is not JSON', async () => {
    const { app } = buildApp(editor);
    const response = await post(app, '/api/things/t1/rename', '{oops');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'bad_request', message: 'The request body is not valid JSON.' },
    });
  });

  test('hides unexpected errors behind a generic 500 and logs them with the request id', async () => {
    const { app, logs } = buildApp(editor, () => {
      throw new Error('connection string with a password');
    });
    const response = await post(app, '/api/things/t1/rename', '{"title":"New"}');
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('password');
    const requestIdHeader = response.headers.get('X-Request-Id');
    expect(text).toContain(`request ${requestIdHeader}`);
    expect(logs).toContainEqual(
      expect.objectContaining({ level: 'error', requestId: requestIdHeader }),
    );
  });
});
