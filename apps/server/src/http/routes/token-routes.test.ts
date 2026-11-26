import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ApiTokenView, Principal, Role } from '@quanthea/shared';
import { createApp } from '../../app.ts';
import { maximumTokensPerUser } from '../../auth/api-tokens.ts';
import { createAuthenticator, sessionCookieName } from '../../auth/authenticator.ts';
import { apiTokenOf } from '../../auth/bearer.ts';
import { createTokenSignIn } from '../../auth/token-sign-in.ts';
import { changeUser } from '../../auth/user-admin.ts';
import { captureLogs, temporaryDir, testServices } from '../../test/fixtures.ts';
import { isOpenToTokens } from '../token-reach.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
const startedAt = Date.parse('2026-11-25T12:00:00Z');
let clock = startedAt;

/** A day, in milliseconds. */
const dayMs = 86_400_000;

beforeEach(async () => {
  clock = startedAt;
  dataDir = temporaryDir();
  services = await testServices(dataDir.path, undefined, () => clock);
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** How a test request signs in, and whether it says it comes from quanthea's own pages. */
interface Credentials {
  /** A session cookie. */
  readonly cookie?: string;
  /** An API token. */
  readonly token?: string;
  /** Whether to leave out `X-Requested-With`, as a script does. */
  readonly bare?: boolean;
}

/**
 * The headers of a test request.
 *
 * @param credentials - How it signs in.
 * @returns The headers.
 */
function headersOf(credentials: Credentials): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(credentials.bare ? {} : { 'X-Requested-With': 'quanthea' }),
    ...(credentials.cookie ? { cookie: `${sessionCookieName}=${credentials.cookie}` } : {}),
    ...(credentials.token ? { authorization: `Bearer ${credentials.token}` } : {}),
  };
}

/**
 * The real app, with sessions and API tokens.
 *
 * @returns A function that sends a request and gives its status and body.
 */
function app() {
  const { sessions, users } = services;
  if (!sessions) throw new Error('The test services have no sessions.');
  const built = createApp({
    version: 'test',
    authenticator: createAuthenticator({ sessions, users }),
    logger: captureLogs().logger,
    webDir: dataDir.path,
    publicUrl: 'https://quanthea.test',
    trustedProxyHops: 0,
    ...services,
  });
  return async (method: string, path: string, credentials: Credentials, body?: unknown) => {
    const init = {
      method,
      headers: headersOf(credentials),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    const response = await built.request(`https://quanthea.test/api${path}`, init);
    return { status: response.status, body: (await response.json()) as unknown };
  };
}

/**
 * A user with a session.
 *
 * @param role - Their role.
 * @param email - Their email.
 * @returns The user's id and their session cookie.
 */
async function signedIn(role: Role, email = `${role}@example.com`) {
  const user = await services.users.create({ email, name: `The ${role}`, role }, 'x');
  const started = await services.sessions?.start(user.id);
  return { id: user.id, cookie: started?.cookie ?? '' };
}

/**
 * A token made through the API.
 *
 * @param cookie - The owner's session.
 * @param role - The token's role.
 * @param expiresInDays - How long it lasts.
 * @returns The token and how it is listed.
 */
async function makeToken(cookie: string, role: Role = 'viewer', expiresInDays = 30) {
  const made = await app()('POST', '/tokens', { cookie }, { name: 'script', role, expiresInDays });
  expect(made.status).toBe(200);
  return made.body as { token: string; details: ApiTokenView };
}

/**
 * Who a token signs in as on the MCP endpoint.
 *
 * @param token - The token.
 * @returns The principal, or `null` when the token signs nobody in.
 */
async function whoIs(token: string): Promise<Principal | null> {
  const { users, apiTokens } = services;
  return (await createTokenSignIn({ users, apiTokens })(token))?.principal ?? null;
}

/**
 * Opens the MCP endpoint as a client does, with the handshake that needs no extra header.
 *
 * @param credentials - How the request signs in.
 * @returns The status and the body.
 */
function discover(credentials: Credentials) {
  const client = { name: 'test', version: '1' };
  const params = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: client };
  const message = { jsonrpc: '2.0', id: 1, method: 'initialize', params };
  return app()('POST', '/mcp', { ...credentials, bare: true }, message);
}

describe('API tokens', () => {
  test('a token signs in as its owner with its own role, and is listed without its value', async () => {
    const editor = await signedIn('editor');
    const { token, details } = await makeToken(editor.cookie, 'viewer');
    expect(token).toStartWith('qth_');
    expect(details).toMatchObject({ name: 'script', role: 'viewer', lastUsedAt: null });
    expect(details.expiresAt).toBe(startedAt + 30 * dayMs);
    expect(await whoIs(token)).toMatchObject({ id: editor.id, name: 'The editor', role: 'viewer' });
    expect((await discover({ token })).status).toBe(200);
    const listed = await app()('GET', '/tokens', { cookie: editor.cookie });
    const { tokens } = listed.body as { tokens: ApiTokenView[] };
    expect(tokens).toEqual([{ ...details, lastUsedAt: startedAt }]);
    expect(JSON.stringify(listed.body)).not.toContain(token);
  });

  test('a token is refused a stronger role than its owner, and a longer life than allowed', async () => {
    const analyst = await signedIn('analyst');
    const stronger = { name: 'script', role: 'editor', expiresInDays: 30 };
    expect((await app()('POST', '/tokens', analyst, stronger)).status).toBe(403);
    const longer = { name: 'script', role: 'viewer', expiresInDays: 366 };
    expect((await app()('POST', '/tokens', analyst, longer)).status).toBe(400);
  });

  test('a person holds a limited number of tokens', async () => {
    const viewer = await signedIn('viewer');
    for (let made = 0; made < maximumTokensPerUser; made += 1) await makeToken(viewer.cookie);
    const body = { name: 'one more', role: 'viewer', expiresInDays: 1 };
    expect((await app()('POST', '/tokens', viewer, body)).status).toBe(409);
  });

  test('a token works on the MCP endpoint only: every other route refuses it', async () => {
    const admin = await signedIn('admin');
    const { token } = await makeToken(admin.cookie, 'admin');
    const refused: [string, string][] = [
      ['GET', '/me'],
      ['GET', '/dashboards'],
      ['POST', '/panels/run'],
      ['POST', '/variables/options'],
      ['GET', '/alerts'],
      ['GET', '/reports'],
      ['GET', '/connectors'],
      ['POST', '/threads/drafts/bin'],
      ['GET', '/settings/retention'],
      ['GET', '/tokens'],
      ['POST', '/tokens'],
      ['GET', '/users'],
      ['POST', '/auth/change-password'],
      ['PUT', '/settings/api-access'],
      ['GET', '/no-such-route'],
      ['POST', '/mcp/'],
      ['POST', '/mcp/more'],
    ];
    for (const [method, path] of refused) {
      for (const bare of [true, false]) {
        const body = method === 'GET' ? undefined : {};
        const answer = await app()(method, path, { token, bare }, body);
        expect([method, path, answer.status]).toEqual([method, path, 403]);
        expect(answer.body).toMatchObject({
          error: { message: 'An MCP token works on the MCP endpoint only, at /api/mcp.' },
        });
      }
    }
    expect((await discover({ token })).status).toBe(200);
  });

  test('a token does not lift the check that a changing request comes from quanthea', async () => {
    const editor = await signedIn('editor');
    const byCookie = await app()('POST', '/threads/drafts/bin', { ...editor, bare: true });
    expect(byCookie.status).toBe(403);
    const stranger = `qth_${'a'.repeat(43)}`;
    const both = { cookie: editor.cookie, token: stranger, bare: true };
    expect((await app()('POST', '/threads/drafts/bin', both)).status).toBe(403);
  });

  test('a request with a token is judged by the token alone, never by its cookie', async () => {
    const editor = await signedIn('editor');
    const unknown = `qth_${'a'.repeat(43)}`;
    expect((await discover({ cookie: editor.cookie, token: unknown })).status).toBe(401);
  });

  test('a token stops when it expires, and the purge deletes it', async () => {
    const viewer = await signedIn('viewer');
    const { token } = await makeToken(viewer.cookie, 'viewer', 1);
    clock = startedAt + dayMs - 1;
    expect(await whoIs(token)).not.toBeNull();
    clock = startedAt + dayMs;
    expect(await whoIs(token)).toBeNull();
    expect((await discover({ token })).status).toBe(401);
    expect(services.apiTokens?.purgeExpired()).toBe(1);
    expect(services.apiTokens?.list(viewer.id)).toEqual([]);
  });

  test('a revoked token stops, and only its owner revokes it', async () => {
    const viewer = await signedIn('viewer');
    const other = await signedIn('editor');
    const { token, details } = await makeToken(viewer.cookie);
    const byOther = await app()('DELETE', `/tokens/${details.id}`, { cookie: other.cookie });
    expect(byOther.body).toEqual({ revoked: false });
    expect(await whoIs(token)).not.toBeNull();
    const byOwner = await app()('DELETE', `/tokens/${details.id}`, { cookie: viewer.cookie });
    expect(byOwner.body).toEqual({ revoked: true });
    expect(await whoIs(token)).toBeNull();
  });

  test('a token follows its owner: a weaker role at once, and none once they are disabled', async () => {
    const admin = await signedIn('admin');
    const editor = await signedIn('editor');
    const { token } = await makeToken(editor.cookie, 'editor');
    changeUser(services.userAdmin, editor.id, { role: 'analyst' }, admin.id);
    expect((await whoIs(token))?.role).toBe('analyst');
    changeUser(services.userAdmin, editor.id, { disabled: true }, admin.id);
    expect(await whoIs(token)).toBeNull();
    changeUser(services.userAdmin, editor.id, { disabled: false }, admin.id);
    expect(await whoIs(token)).toBeNull();
  });

  test('an admin revokes every token of a user', async () => {
    const admin = await signedIn('admin');
    const viewer = await signedIn('viewer');
    const { token } = await makeToken(viewer.cookie);
    await makeToken(viewer.cookie);
    const revoked = await app()('DELETE', `/users/${viewer.id}/tokens`, { cookie: admin.cookie });
    expect(revoked.body).toEqual({ revoked: 2 });
    expect(await whoIs(token)).toBeNull();
    const byViewer = await app()('DELETE', `/users/${admin.id}/tokens`, { cookie: viewer.cookie });
    expect(byViewer.status).toBe(403);
  });

  test('an admin revokes every token of everyone', async () => {
    const admin = await signedIn('admin');
    const viewer = await signedIn('viewer');
    const first = await makeToken(admin.cookie, 'admin');
    const second = await makeToken(viewer.cookie);
    const byViewer = await app()('DELETE', '/settings/api-access/tokens', viewer);
    expect(byViewer.status).toBe(403);
    expect(await whoIs(second.token)).not.toBeNull();
    const revoked = await app()('DELETE', '/settings/api-access/tokens', admin);
    expect(revoked.body).toEqual({ revoked: 2 });
    expect(await whoIs(first.token)).toBeNull();
    expect((await discover({ token: second.token })).status).toBe(401);
    expect(services.apiTokens?.list(viewer.id)).toEqual([]);
  });

  test('a tool call is kept 90 days', async () => {
    const token = { id: 't1', name: 'client' };
    const call = { token, userId: 'u1', role: 'viewer' as const, tool: 'run_panel', input: {} };
    services.tokenActivity.record({ ...call, outcome: 'ok', durationMs: 3, address: '10.0.0.1' });
    clock = startedAt + 90 * dayMs;
    expect(services.tokenActivity.purgeOld()).toBe(0);
    clock = startedAt + 90 * dayMs + 1;
    expect(services.tokenActivity.purgeOld()).toBe(1);
    expect(await services.tokenActivity.latest()).toEqual([]);
  });

  test('with the MCP server turned off no token is made and the endpoint refuses', async () => {
    const admin = await signedIn('admin');
    const { token } = await makeToken(admin.cookie, 'viewer');
    const off = { mcp: false, maxLifetimeDays: 365, mcpQueryTools: false };
    expect((await app()('PUT', '/settings/api-access', admin, off)).body).toEqual(off);
    expect((await discover({ token })).status).toBe(403);
    const body = { name: 'client', role: 'viewer', expiresInDays: 1 };
    expect((await app()('POST', '/tokens', admin, body)).status).toBe(403);
    await app()('PUT', '/settings/api-access', admin, { mcp: true, maxLifetimeDays: 7 });
    expect((await discover({ token })).status).toBe(200);
    const listed = await app()('GET', '/tokens', admin);
    expect((listed.body as { settings: unknown }).settings).toEqual({
      mcp: true,
      maxLifetimeDays: 7,
      mcpQueryTools: false,
    });
  });
});

describe('apiTokenOf', () => {
  /**
   * A request with an `Authorization` header.
   *
   * @param authorization - The header's value.
   * @returns The request.
   */
  const withHeader = (authorization: string) =>
    new Request('https://quanthea.test/api/me', { headers: { authorization } });

  test('reads a bearer value that is an API token, whatever the case of the scheme', () => {
    expect(apiTokenOf(withHeader('Bearer qth_abc'))).toBe('qth_abc');
    expect(apiTokenOf(withHeader('bearer qth_abc'))).toBe('qth_abc');
  });

  test('ignores another scheme, another bearer value, and a value too long to be a token', () => {
    expect(apiTokenOf(withHeader('Basic cXRoXzp4'))).toBeUndefined();
    expect(apiTokenOf(withHeader('Bearer eyJhbGciOi'))).toBeUndefined();
    expect(apiTokenOf(withHeader('Bearer qth_abc extra'))).toBeUndefined();
    expect(apiTokenOf(withHeader(`Bearer qth_${'a'.repeat(200)}`))).toBeUndefined();
    expect(apiTokenOf(new Request('https://quanthea.test/api/me'))).toBeUndefined();
  });
});

describe('isOpenToTokens', () => {
  test('opens the MCP endpoint and no other path', () => {
    expect(isOpenToTokens('/api/mcp')).toBe(true);
    expect(isOpenToTokens('/api/mcp/')).toBe(false);
    expect(isOpenToTokens('/api/mcp/tools')).toBe(false);
    expect(isOpenToTokens('/api/mcpx')).toBe(false);
    expect(isOpenToTokens('/api/me')).toBe(false);
    expect(isOpenToTokens('/api/panels/run')).toBe(false);
    expect(isOpenToTokens('/mcp')).toBe(false);
  });
});
