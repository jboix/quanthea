import { describe, expect, test } from 'bun:test';
import { type Principal, type Role, roles } from '@querent/shared';
import { createMemoryRouter } from 'react-router';
import type { ApiClient } from '../lib/api-client.ts';
import { routeAccess } from './route-access.ts';
import { createRoutes } from './router.tsx';
import type { Session } from './session.ts';

/**
 * A session for a user with `role` in `none`-independent terms.
 *
 * @param role - The role of the user.
 * @returns The session.
 */
function sessionFor(role: Role): Session {
  const principal: Principal = { id: `user-${role}`, name: role, role };
  return { principal, authMode: 'basic' };
}

/** A connector as the fake API returns it. */
const sampleConnector = {
  id: 'sample-connectorId',
  name: 'events',
  kind: 'memory',
  accessLevel: 2,
  updatedAt: 1,
  createdAt: 1,
  config: {},
  target: null,
  secret: {},
  hiddenFields: [],
  guardrails: { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 },
  descriptions: {},
};

/** What the fake API answers, by method and path. */
const cannedAnswers: Readonly<Record<string, unknown>> = {
  'GET /connectors': [],
  'GET /connector-kinds': [],
  'GET /connectors/:connectorId': sampleConnector,
  'GET /connectors/:connectorId/schema': { readAt: null, entities: [] },
  'POST /connectors/:connectorId/test': { ok: true, latencyMs: 1, message: 'ok', readOnly: null },
  'GET /dashboards': { results: [], tags: [], connectors: [] },
  'GET /dashboards/:dashboardId': { pinnedVersion: 1, versions: [] },
  'GET /dashboards/:dashboardId/versions/:version': { version: 1, spec: { panels: [] } },
  'POST /panels/run': { time: { from: 0, to: 1 }, queries: [], markers: [], durationMs: 1 },
  'POST /variables/options': { options: [] },
  'GET /threads': [],
  'GET /model-providers': {
    providers: [
      { id: 'anthropic', name: 'Anthropic', provider: 'anthropic', buildModel: 'claude-sonnet-5' },
    ],
    defaultProviderId: 'anthropic',
  },
  'GET /threads/:threadId': {
    id: 'sample-threadId',
    title: null,
    state: 'idle',
    dashboardId: null,
    tokensUsed: 0,
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    plans: [],
    providerId: null,
    queries: { mode: 'default' },
    model: 'claude-sonnet-5',
    providerName: 'Anthropic',
    connectors: [],
  },
  'GET /queries': { queries: [] },
  'GET /settings/charts': { disabled: [] },
  'GET /settings/queries': { disabled: [], saved: [] },
  'GET /settings/queries/guide': { builders: [], connectors: [] },
  'GET /settings/usage': { from: 0, to: 1, pricesCheckedOn: '2026-09-29', buckets: [] },
  'GET /settings/model': {
    gateway: {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          provider: 'anthropic',
          baseUrl: null,
          models: { plan: '', build: 'claude-sonnet-5', repair: '', metadata: '' },
        },
      ],
      defaultProviderId: 'anthropic',
      limits: { threadTokens: 200_000, toolCallsPerTurn: 25, repairAttempts: 3 },
      behaviour: { planApproval: true, testRun: true, shortReasoning: true },
    },
    keys: { anthropic: null },
    usage: { tokens: 0, threads: 0, pinnedViews: 0, dollars: 0 },
  },
};

/** An API client that answers every call from {@link cannedAnswers}. */
const fakeApi = {
  call: (endpoint: { method: string; path: string }) =>
    Promise.resolve(cannedAnswers[`${endpoint.method} ${endpoint.path}`]),
} as ApiClient;

/**
 * Starts a memory router at `path` and waits until its loaders have settled.
 *
 * @param path - The initial URL.
 * @param session - The session every loader sees, or `null` for "not signed in".
 * @returns The router state once idle.
 */
async function navigate(path: string, session: Session | null) {
  const router = createMemoryRouter(
    createRoutes({ loadSession: () => Promise.resolve(session), api: fakeApi }),
    { initialEntries: [path] },
  );
  await new Promise<void>((resolve) => {
    const isSettled = () => router.state.initialized && router.state.navigation.state === 'idle';
    if (isSettled()) return resolve();
    const unsubscribe = router.subscribe(() => {
      if (!isSettled()) return;
      unsubscribe();
      resolve();
    });
  });
  return router.state;
}

/**
 * Fills every `:name` segment with a sample value.
 *
 * @param pattern - A route pattern such as `/d/:dashboardId`.
 * @returns A concrete path.
 */
function samplePath(pattern: string): string {
  return pattern.replace(/:([A-Za-z]+)/g, 'sample-$1');
}

/**
 * Collects the distinct HTTP statuses of the route errors in a state. A layout and its child can
 * both refuse the same navigation.
 *
 * @param errors - `router.state.errors`.
 * @returns The statuses, empty when no route failed. An error without a status, such as a
 *   loader that crashed, is reported by its message, so it can never pass for "no error".
 */
function errorStatuses(errors: Record<string, unknown> | null): unknown[] {
  const statuses = Object.values(errors ?? {}).map((error) => {
    const { status, message } = error as { status?: number; message?: string };
    return status ?? `no status: ${message}`;
  });
  return [...new Set(statuses)];
}

describe('screen access', () => {
  for (const [pattern, minimum] of Object.entries(routeAccess)) {
    for (const role of roles) {
      const allowed = roles.indexOf(role) >= roles.indexOf(minimum);
      test(`${role} ${allowed ? 'opens' : 'gets 403 on'} ${pattern}`, async () => {
        const state = await navigate(samplePath(pattern), sessionFor(role));
        expect(state.location.pathname).toBe(samplePath(pattern));
        expect(errorStatuses(state.errors)).toEqual(allowed ? [] : [403]);
      });
    }
  }
});

describe('redirects', () => {
  test.each([
    ['viewer', '/library'],
    ['editor', '/threads/new'],
    ['admin', '/threads/new'],
  ] as const)('/ sends a %s to %s', async (role, target) => {
    expect((await navigate('/', sessionFor(role))).location.pathname).toBe(target);
  });

  test('a screen without a session sends the user to the login page, remembering the path', async () => {
    const state = await navigate('/d/abc?from=link', null);
    expect(state.location.pathname).toBe('/login');
    expect(state.location.search).toBe(`?next=${encodeURIComponent('/d/abc?from=link')}`);
  });

  test('the login page sends a signed-in user on to a local path only', async () => {
    const admin = sessionFor('admin');
    expect((await navigate('/login?next=/bin', admin)).location.pathname).toBe('/bin');
    expect((await navigate('/login?next=//evil.example', admin)).location.pathname).toBe(
      '/threads/new',
    );
  });

  test('the login page stays put without a session', async () => {
    const state = await navigate('/login', null);
    expect(state.location.pathname).toBe('/login');
    expect(state.errors).toBeNull();
  });

  test('/settings opens the model section', async () => {
    expect((await navigate('/settings', sessionFor('admin'))).location.pathname).toBe(
      '/settings/model',
    );
  });

  test('an unknown path renders the not-found screen without an error', async () => {
    const state = await navigate('/nowhere', sessionFor('viewer'));
    expect(state.errors).toBeNull();
    expect(state.matches.at(-1)?.route.path).toBe('*');
  });
});
