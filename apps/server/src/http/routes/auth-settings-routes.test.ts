import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '../../app.ts';
import { createAuthenticator, sessionCookieName } from '../../auth/authenticator.ts';
import { captureLogs, temporaryDir, testServices } from '../../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * The real app, its authenticator following the mode in force.
 *
 * @returns A function that sends a request, with a session cookie if given.
 */
function app() {
  const { sessions, users } = services;
  const built = createApp({
    version: 'test',
    authenticator: createAuthenticator(
      () => services.authMode.current(),
      sessions && { sessions, users },
    ),
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
    const session = /__Host-querent_session=([^;]+)/.exec(
      response.headers.get('set-cookie') ?? '',
    )?.[1];
    return { status: response.status, body: (await response.json()) as unknown, session };
  };
}

describe('switching the authentication mode', () => {
  test('needs an admin who can sign in, hands over open-access threads, and ends sessions', async () => {
    const call = app();
    const openThread = (await call('POST', '/threads', {})).body as { id: string };
    const refused = await call('PUT', '/settings/auth', { mode: 'accounts' });
    expect(refused.status).toBe(400);
    const made = await call('POST', '/users', {
      email: 'root@example.com',
      name: 'Root',
      role: 'admin',
    });
    const token = (made.body as { invite: { link: string } }).invite.link.split('#')[1];
    const set = await call('POST', '/auth/set-password', {
      token,
      password: 'violet harbour lantern 42',
    });
    expect((await call('GET', '/settings/auth')).body).toMatchObject({
      mode: 'none',
      openAccessThreads: 1,
    });

    const switched = await call('PUT', '/settings/auth', { mode: 'accounts' });
    expect(switched.body).toMatchObject({ mode: 'accounts', openAccessThreads: 0 });
    expect((await call('GET', '/me')).status).toBe(401);
    expect((await call('GET', '/me', undefined, set.session)).status).toBe(401);
    const signedIn = await call('POST', '/auth/sign-in', {
      email: 'root@example.com',
      password: 'violet harbour lantern 42',
    });
    const mine = await call('GET', '/threads', undefined, signedIn.session);
    expect(mine.body).toMatchObject([{ id: openThread.id }]);

    const back = await call('PUT', '/settings/auth', { mode: 'none' }, signedIn.session);
    expect(back.body).toMatchObject({ mode: 'none' });
    expect((await call('GET', '/me')).body).toMatchObject({ principal: { id: 'anonymous' } });
  });

  test('ends every session of oneself with sign out everywhere', async () => {
    const call = app();
    const made = await call('POST', '/users', {
      email: 'root@example.com',
      name: 'Root',
      role: 'admin',
    });
    const token = (made.body as { invite: { link: string } }).invite.link.split('#')[1];
    await call('POST', '/auth/set-password', { token, password: 'violet harbour lantern 42' });
    await call('PUT', '/settings/auth', { mode: 'accounts' });
    const credentials = { email: 'root@example.com', password: 'violet harbour lantern 42' };
    const first = await call('POST', '/auth/sign-in', credentials);
    const second = await call('POST', '/auth/sign-in', credentials);
    expect(
      (await call('POST', '/auth/sign-out-everywhere', undefined, first.session)).body,
    ).toEqual({ ended: 2 });
    expect((await call('GET', '/me', undefined, second.session)).status).toBe(401);
  });
});
