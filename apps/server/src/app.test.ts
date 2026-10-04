import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasRole, type Role } from '@quanthea/shared';
import { z } from 'zod';
import { createApp } from './app.ts';
import { listApiRouteAccess } from './http/access.ts';
import {
  captureLogs,
  fixedAuthenticator,
  temporaryDir,
  testAdmin,
  testServices,
} from './test/fixtures.ts';

let webDir: ReturnType<typeof temporaryDir>;
let dataDir: ReturnType<typeof temporaryDir>;
let services: Omit<Awaited<ReturnType<typeof testServices>>, 'close'>;
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
    authenticator: fixedAuthenticator(testAdmin),
    logger: captureLogs().logger,
    publicUrl: undefined,
    trustedProxyHops: 0,
    webDir: webDir.path,
    ...services,
  });
}

describe('requests from other sites', () => {
  test('refuses a change without quanthea’s header, or from another origin', async () => {
    const app = buildApp();
    const post = (headers: Record<string, string>) =>
      app.request('http://quanthea.test/api/auth/sign-out', { method: 'POST', headers });
    expect((await post({})).status).toBe(403);
    expect(
      (await post({ 'X-Requested-With': 'quanthea', Origin: 'https://evil.test' })).status,
    ).toBe(403);
    const crossSite = { 'X-Requested-With': 'quanthea', 'Sec-Fetch-Site': 'cross-site' };
    expect((await post(crossSite)).status).toBe(403);
    const own = { 'X-Requested-With': 'quanthea', Origin: 'http://quanthea.test' };
    expect((await post(own)).status).toBe(200);
  });

  test('lets reads through, and marks API answers as never to be cached', async () => {
    const response = await buildApp().request('http://quanthea.test/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("base-uri 'none'");
    expect(response.headers.get('strict-transport-security')).toBeNull();
  });
});

describe('route access', () => {
  test('every /api route is public or declares a minimum role', () => {
    const undeclared = listApiRouteAccess(buildApp()).filter((route) => route.access === undefined);
    expect(undeclared).toEqual([]);
  });

  test('only the known routes are public', () => {
    const publicRoutes = listApiRouteAccess(buildApp())
      .filter((route) => route.access === 'public')
      .map((route) => `${route.method} ${route.path}`);
    expect(publicRoutes.sort()).toEqual([
      'GET /api/auth/options',
      'GET /api/auth/providers/:providerId/callback',
      'GET /api/auth/providers/:providerId/start',
      'GET /api/health',
      'GET /api/me',
      'POST /api/auth/set-password',
      'POST /api/auth/setup',
      'POST /api/auth/sign-in',
      'POST /api/auth/sign-out',
    ]);
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
    expect(settingsRoutes.length).toBe(28);
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

  test('a snapshot opens for any role; editors take and revoke; admins list them all', () => {
    const snapshotRoutes = listApiRouteAccess(buildApp())
      .filter((route) => /snapshots/.test(route.path))
      .map((route) => `${route.access} ${route.method} ${route.path}`);
    expect(snapshotRoutes.sort()).toEqual([
      'admin GET /api/snapshots',
      'editor DELETE /api/snapshots/:snapshotId',
      'editor GET /api/dashboards/:dashboardId/snapshots',
      'editor POST /api/snapshots',
      'viewer GET /api/snapshots/:snapshotId',
    ]);
  });

  test('an analyst reaches what a viewer reaches, and asks about dashboards and panels', () => {
    const reachable = (role: Role) =>
      listApiRouteAccess(buildApp())
        .filter((route) => route.access === 'public' || hasRole(role, route.access ?? 'admin'))
        .map((route) => `${route.method} ${route.path}`);
    const viewers = new Set(reachable('viewer'));
    expect(
      reachable('analyst')
        .filter((route) => !viewers.has(route))
        .sort(),
    ).toEqual([
      'POST /api/alerts/:alertId/mute',
      'POST /api/alerts/:alertId/unmute',
      'POST /api/dashboards/:dashboardId/questions',
      'POST /api/dashboards/:dashboardId/versions/:version/panels/:panelId/explanation',
    ]);
    expect(reachable('viewer').every((route) => reachable('analyst').includes(route))).toBe(true);
  });

  test('every role reads and searches conversations; analysts and above ask', () => {
    const questionRoutes = listApiRouteAccess(buildApp())
      .filter((route) => /questions|conversations|sources/.test(route.path))
      .map((route) => `${route.access} ${route.method} ${route.path}`);
    expect(questionRoutes.sort()).toEqual([
      'analyst POST /api/dashboards/:dashboardId/questions',
      'viewer GET /api/dashboards/:dashboardId/conversations',
      'viewer GET /api/dashboards/:dashboardId/conversations/:conversationId',
      'viewer GET /api/dashboards/:dashboardId/questions/:questionId',
      'viewer GET /api/dashboards/:dashboardId/similar-questions',
      'viewer GET /api/dashboards/:dashboardId/versions/:version/sources',
    ]);
  });

  test('every role reads and replays alerts; analysts mute; editors activate, replay drafts and test', () => {
    const alertRoutes = listApiRouteAccess(buildApp())
      .filter((route) => /^\/api\/alerts/.test(route.path))
      .map((route) => `${route.access} ${route.method} ${route.path}`);
    expect(alertRoutes.sort()).toEqual([
      'analyst POST /api/alerts/:alertId/mute',
      'analyst POST /api/alerts/:alertId/unmute',
      'editor POST /api/alerts/:alertId/activate',
      'editor POST /api/alerts/:alertId/deactivate',
      'editor POST /api/alerts/:alertId/versions/:version/test',
      'editor POST /api/alerts/replay',
      'viewer GET /api/alerts',
      'viewer GET /api/alerts/:alertId',
      'viewer POST /api/alerts/:alertId/versions/:version/replay',
    ]);
  });

  test('editors hand-edit an alert thread’s draft', () => {
    const draftRoutes = listApiRouteAccess(buildApp())
      .filter((route) => /alert-draft/.test(route.path))
      .map((route) => `${route.access} ${route.method} ${route.path}`);
    expect(draftRoutes).toEqual(['editor POST /api/threads/:threadId/alert-draft']);
  });

  test('every role reads a panel explanation; analysts and above ask for one', () => {
    const explanationRoutes = listApiRouteAccess(buildApp())
      .filter((route) => /explanation/.test(route.path))
      .map((route) => `${route.access} ${route.method} ${route.path}`);
    expect(explanationRoutes.sort()).toEqual([
      'analyst POST /api/dashboards/:dashboardId/versions/:version/panels/:panelId/explanation',
      'viewer GET /api/dashboards/:dashboardId/versions/:version/panels/:panelId/explanation',
    ]);
  });

  test('admins keep notification channels; editors pick them and preview messages', () => {
    const channelRoutes = listApiRouteAccess(buildApp())
      .filter((route) => /notification/.test(route.path))
      .map((route) => `${route.access} ${route.method} ${route.path}`);
    expect(channelRoutes.sort()).toEqual([
      'admin DELETE /api/settings/notification-channels/:channelId',
      'admin GET /api/settings/notification-channels',
      'admin GET /api/settings/notification-channels/:channelId/sends',
      'admin PATCH /api/settings/notification-channels/:channelId',
      'admin POST /api/settings/notification-channels',
      'admin POST /api/settings/notification-channels/:channelId/test',
      'editor GET /api/notification-channels',
      'editor POST /api/notification-channels/preview',
    ]);
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

  test('GET /api/me returns the signed-in principal', async () => {
    const body = z
      .object({ principal: z.object({ role: z.string() }) })
      .parse(await (await buildApp().request('/api/me')).json());
    expect(body).toEqual({ principal: { role: 'admin' } });
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
