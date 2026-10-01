import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Principal } from '@quanthea/shared';
import { createApp } from '../../app.ts';
import { createAuthenticator, sessionCookieName } from '../../auth/authenticator.ts';
import { resetLifetimeMs } from '../../auth/password-accounts.ts';
import { captureLogs, temporaryDir, testServices } from '../../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
const startedAt = Date.parse('2026-09-29T12:00:00Z');
let clock = startedAt;

beforeEach(async () => {
  clock = startedAt;
  dataDir = temporaryDir();
  services = await testServices(dataDir.path, undefined, () => clock);
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** A strong password. */
const strong = 'violet harbour lantern 42';

/**
 * The real app in accounts mode.
 *
 * @returns A function that sends a request, with a session cookie if given.
 */
function app() {
  const sessions = services.sessions;
  if (!sessions) throw new Error('The test services have no sessions.');
  const built = createApp({
    version: 'test',
    authenticator: createAuthenticator({ sessions, users: services.users }),
    logger: captureLogs().logger,
    webDir: dataDir.path,
    publicUrl: 'https://querent.test',
    trustedProxyHops: 0,
    ...services,
  });
  return async (method: string, path: string, body?: unknown, cookie?: string) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'querent',
      ...(cookie ? { cookie: `${sessionCookieName}=${cookie}` } : {}),
    };
    const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    const response = await built.request(`https://querent.test/api${path}`, init);
    const set = response.headers.get('set-cookie') ?? '';
    const session = new RegExp(`${sessionCookieName}=([^;]+)`).exec(set)?.[1];
    return { status: response.status, body: (await response.json()) as never, session };
  };
}

/**
 * An admin with a password, signed in.
 *
 * @returns The admin and their session cookie.
 */
async function signedInAdmin(): Promise<{ admin: Principal; cookie: string }> {
  const user = await services.users.create(
    { email: 'root@example.com', name: 'Root', role: 'admin' },
    'x',
  );
  const passwords = services.passwords;
  if (!passwords) throw new Error('The test services have no passwords.');
  const { token } = await passwords.issueLink(user.id, 'invite', 'x');
  const set = await app()('POST', '/auth/set-password', { token, password: strong });
  return { admin: { id: user.id, name: 'Root', role: 'admin' }, cookie: set.session ?? '' };
}

/**
 * An invite made through the API by an admin.
 *
 * @param cookie - The admin's session.
 * @param email - The new user's email.
 * @returns The token of the invite link.
 */
async function invite(cookie: string, email = 'ada@example.com'): Promise<string> {
  const made = await app()(
    'POST',
    '/users',
    { email, name: 'Ada Lovelace', role: 'editor' },
    cookie,
  );
  expect(made.status).toBe(200);
  const { link } = (made.body as { invite: { link: string } }).invite;
  expect(link).toStartWith('https://querent.test/set-password#');
  return link.split('#')[1] ?? '';
}

describe('passwords', () => {
  test('an invite sets a password once, and a weak password leaves the link usable', async () => {
    const { cookie } = await signedInAdmin();
    const token = await invite(cookie);
    const weak = await app()('POST', '/auth/set-password', { token, password: 'short' });
    expect(weak.status).toBe(400);
    const set = await app()('POST', '/auth/set-password', { token, password: strong });
    expect(set.status).toBe(200);
    expect(set.session).toBeDefined();
    expect((set.body as { principal: Principal }).principal).toMatchObject({ role: 'editor' });
    const again = await app()('POST', '/auth/set-password', { token, password: `${strong}!` });
    expect(again.status).toBe(400);
  });

  test('sign in with the right password, and the same answer for any wrong detail', async () => {
    const { cookie } = await signedInAdmin();
    await app()('POST', '/auth/set-password', { token: await invite(cookie), password: strong });
    const ok = await app()('POST', '/auth/sign-in', {
      email: ' ADA@example.com',
      password: strong,
    });
    expect(ok.status).toBe(200);
    const me = await app()('GET', '/me', undefined, ok.session);
    expect(me.body).toMatchObject({ principal: { name: 'Ada Lovelace', role: 'editor' } });
    const wrong = await app()('POST', '/auth/sign-in', {
      email: 'ada@example.com',
      password: 'nope',
    });
    const unknown = await app()('POST', '/auth/sign-in', {
      email: 'who@example.com',
      password: strong,
    });
    expect(wrong).toEqual({ status: 401, body: unknown.body, session: undefined });
    expect(unknown.status).toBe(401);
  });

  test('throttle an account after five failures, whatever the address, then let it try again', async () => {
    const { cookie } = await signedInAdmin();
    await app()('POST', '/auth/set-password', { token: await invite(cookie), password: strong });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await app()('POST', '/auth/sign-in', {
        email: 'ada@example.com',
        password: 'x',
      });
      expect(failed.status).toBe(401);
    }
    await app()('POST', '/auth/sign-in', { email: 'ada@example.com', password: 'x' });
    const blocked = await app()('POST', '/auth/sign-in', {
      email: 'ada@example.com',
      password: strong,
    });
    expect(blocked.status).toBe(429);
    clock += 3 * 60_000;
    expect(
      (await app()('POST', '/auth/sign-in', { email: 'ada@example.com', password: strong })).status,
    ).toBe(200);
  });

  test('a reset link replaces the invite, expires, and a disabled user cannot sign in', async () => {
    const { cookie } = await signedInAdmin();
    const invited = await invite(cookie);
    const users = (await app()('GET', '/users', undefined, cookie)).body as {
      users: { id: string; email: string }[];
    };
    const ada = users.users.find((user) => user.email === 'ada@example.com')?.id ?? '';
    const reset = await app()('POST', `/users/${ada}/reset-link`, undefined, cookie);
    const token = (reset.body as { link: string }).link.split('#')[1] ?? '';
    expect(
      (await app()('POST', '/auth/set-password', { token: invited, password: strong })).status,
    ).toBe(400);
    clock += resetLifetimeMs + 1;
    expect((await app()('POST', '/auth/set-password', { token, password: strong })).status).toBe(
      400,
    );
    // The jump idled the admin's session out too.
    const back = await app()('POST', '/auth/sign-in', {
      email: 'root@example.com',
      password: strong,
    });
    const admin = back.session ?? '';
    const fresh = await app()('POST', `/users/${ada}/reset-link`, undefined, admin);
    const freshToken = (fresh.body as { link: string }).link.split('#')[1] ?? '';
    const signedIn = await app()('POST', '/auth/set-password', {
      token: freshToken,
      password: strong,
    });
    expect(signedIn.status).toBe(200);
    expect((await app()('PATCH', `/users/${ada}`, { disabled: true }, admin)).status).toBe(200);
    expect((await app()('GET', '/me', undefined, signedIn.session)).status).toBe(401);
    expect(
      (await app()('POST', '/auth/sign-in', { email: 'ada@example.com', password: strong })).status,
    ).toBe(401);
  });

  test('changing a password ends the other sessions', async () => {
    const { cookie } = await signedInAdmin();
    const other = await app()('POST', '/auth/sign-in', {
      email: 'root@example.com',
      password: strong,
    });
    const wrong = await app()(
      'POST',
      '/auth/change-password',
      { current: 'nope', password: `${strong}!` },
      cookie,
    );
    expect(wrong.status).toBe(400);
    const changed = await app()(
      'POST',
      '/auth/change-password',
      { current: strong, password: `${strong}!` },
      cookie,
    );
    expect(changed.status).toBe(200);
    expect(changed.session).toBeDefined();
    expect((await app()('GET', '/me', undefined, other.session)).status).toBe(401);
    expect((await app()('GET', '/me', undefined, changed.session)).status).toBe(200);
  });

  test('keep one admin who can sign in, and let only admins manage users', async () => {
    const { admin, cookie } = await signedInAdmin();
    expect((await app()('PATCH', `/users/${admin.id}`, { role: 'editor' }, cookie)).status).toBe(
      400,
    );
    expect((await app()('PATCH', `/users/${admin.id}`, { disabled: true }, cookie)).status).toBe(
      400,
    );
    await app()('POST', '/auth/set-password', { token: await invite(cookie), password: strong });
    const editor = await app()('POST', '/auth/sign-in', {
      email: 'ada@example.com',
      password: strong,
    });
    expect((await app()('GET', '/users', undefined, editor.session)).status).toBe(403);
    expect((await app()('GET', '/users')).status).toBe(401);
  });

  test('write no email or password into the audit log', async () => {
    const { cookie } = await signedInAdmin();
    await app()('POST', '/auth/set-password', { token: await invite(cookie), password: strong });
    await app()('POST', '/auth/sign-in', { email: 'ada@example.com', password: 'wrong one' });
    const rows = services.database
      .query<{ action: string; detail: string | null }, []>('SELECT action, detail FROM audit_log')
      .all();
    const text = JSON.stringify(rows);
    for (const secret of ['ada@example.com', 'root@example.com', strong, 'wrong one']) {
      expect(text).not.toContain(secret);
    }
    expect(rows.map((row) => row.action)).toContain('auth.sign-in-failed');
  });
});
