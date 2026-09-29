import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createApp } from './app.ts';
import { anonymousAdmin } from './auth/authenticator.ts';
import { listApiRouteAccess } from './http/access.ts';
import type { Services } from './services.ts';
import { captureLogs, fixedAuthenticator, temporaryDir, testServices } from './test/fixtures.ts';

let webDir: ReturnType<typeof temporaryDir>;
let dataDir: ReturnType<typeof temporaryDir>;
let services: Services;
let closeServices: () => Promise<void>;

beforeEach(async () => {
  dataDir = temporaryDir();
  ({ close: closeServices, ...services } = await testServices(dataDir.path));
  webDir = temporaryDir();
  mkdirSync(join(webDir.path, 'assets'));
  writeFileSync(join(webDir.path, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(webDir.path, 'assets', 'main-abc123.js'), 'export {}');
  writeFileSync(join(webDir.path, 'favicon.svg'), '<svg/>');
});

afterEach(async () => {
  webDir.remove();
  await closeServices();
  dataDir.remove();
});

/**
 * Builds the real app in `none` mode over the temporary SPA directory.
 *
 * @returns The app.
 */
function buildApp() {
  return createApp({
    version: '1.2.3',
    authenticator: fixedAuthenticator(anonymousAdmin),
    logger: captureLogs().logger,
    webDir: webDir.path,
    ...services,
  });
}

describe('route access', () => {
  test('every /api route is public or declares a minimum role', () => {
    const undeclared = listApiRouteAccess(buildApp()).filter((route) => route.access === undefined);
    expect(undeclared).toEqual([]);
  });

  test('only the known routes are public', () => {
    const publicRoutes = listApiRouteAccess(buildApp())
      .filter((route) => route.access === 'public')
      .map((route) => `${route.method} ${route.path}`);
    expect(publicRoutes.sort()).toEqual(['GET /api/health', 'GET /api/me']);
  });

  test('every connector route needs the admin role', () => {
    const connectorRoutes = listApiRouteAccess(buildApp()).filter((route) =>
      /^\/api\/connector/.test(route.path),
    );
    expect(connectorRoutes.length).toBe(9);
    expect(connectorRoutes.every((route) => route.access === 'admin')).toBe(true);
  });

  test('every settings route needs the admin role', () => {
    const settingsRoutes = listApiRouteAccess(buildApp()).filter((route) =>
      /^\/api\/settings/.test(route.path),
    );
    expect(settingsRoutes.length).toBe(7);
    expect(settingsRoutes.every((route) => route.access === 'admin')).toBe(true);
  });

  test('every thread route, the streamed chat too, needs the editor role', () => {
    const threadRoutes = listApiRouteAccess(buildApp()).filter((route) =>
      /^\/api\/threads/.test(route.path),
    );
    expect(threadRoutes.map((route) => `${route.method} ${route.path}`)).toContain(
      'POST /api/threads/:threadId/chat',
    );
    expect(threadRoutes.every((route) => route.access === 'editor')).toBe(true);
  });

  test('the audit reports a route mounted without an access declaration', () => {
    const app = buildApp();
    app.get('/api/sneaky', (context) => context.json({}));
    const sneaky = listApiRouteAccess(app).find((route) => route.path === '/api/sneaky');
    expect(sneaky).toEqual({ method: 'GET', path: '/api/sneaky', access: undefined });
  });
});

describe('system routes', () => {
  test('GET /api/health reports the version', async () => {
    const response = await buildApp().request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });

  test('GET /api/me returns the anonymous admin in none mode', async () => {
    const body = z
      .object({ principal: z.object({ role: z.string() }), authMode: z.string() })
      .parse(await (await buildApp().request('/api/me')).json());
    expect(body).toEqual({ principal: { role: 'admin' }, authMode: 'none' });
  });

  test('every response carries a request id and the security headers', async () => {
    const response = await buildApp().request('/api/health');
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  test('an unknown /api route answers 404 in the error shape, not the SPA', async () => {
    const response = await buildApp().request('/api/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'No route for GET /api/nope.' },
    });
  });
});

describe('SPA', () => {
  test('client routes fall back to index.html, uncached', async () => {
    const response = await buildApp().request('/d/some-dashboard/v/3');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(await response.text()).toContain('<div id="root">');
  });

  test('the root serves index.html', async () => {
    const response = await buildApp().request('/');
    expect(await response.text()).toContain('<div id="root">');
  });

  test('hashed assets are served with a long cache lifetime', async () => {
    const response = await buildApp().request('/assets/main-abc123.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await response.text()).toBe('export {}');
  });

  test('other static files are served but revalidated', async () => {
    const response = await buildApp().request('/favicon.svg');
    expect(response.headers.get('Content-Type')).toStartWith('image/svg+xml');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  test('path traversal does not escape the web directory', async () => {
    const response = await buildApp().request('/assets/../../etc/passwd');
    expect(await response.text()).toContain('<div id="root">');
  });

  test('answers 503 when the SPA is not built', async () => {
    webDir.remove();
    const response = await buildApp().request('/library');
    expect(response.status).toBe(503);
  });
});
