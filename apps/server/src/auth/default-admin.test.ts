import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '../app.ts';
import { captureLogs, temporaryDir, testServices } from '../test/fixtures.ts';
import { createAuthenticator, sessionCookieName } from './authenticator.ts';
import { ensureAdmin, generatedPassword } from './default-admin.ts';

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
 * Makes sure an admin exists, as the server does at startup.
 *
 * @returns The password written to the log, if one was.
 */
async function startUp(): Promise<string | undefined> {
  const { logger, lines } = captureLogs();
  if (!services.adminSetup) throw new Error('The test services cannot set up an admin.');
  await ensureAdmin(services.adminSetup, logger);
  const line = lines.find((each) => typeof each.password === 'string');
  return line?.password as string | undefined;
}

/**
 * Sends a request to the real app.
 *
 * @param method - The method.
 * @param path - The path under `/api`.
 * @param body - The JSON body, if any.
 * @param cookie - The session cookie, if any.
 * @returns The status, the body and the new session cookie, if one was set.
 */
async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const sessions = services.sessions;
  if (!sessions) throw new Error('The test services have no sessions.');
  const app = createApp({
    version: 'test',
    authenticator: createAuthenticator({ sessions, users: services.users }),
    logger: captureLogs().logger,
    webDir: dataDir.path,
    publicUrl: undefined,
    trustedProxyHops: 0,
    ...services,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'quanthea',
    ...(cookie ? { cookie: `${sessionCookieName}=${cookie}` } : {}),
  };
  const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  const response = await app.request(`http://quanthea.test/api${path}`, init);
  const set = response.headers.get('set-cookie') ?? '';
  const session = new RegExp(`${sessionCookieName}=([^;]+)`).exec(set)?.[1];
  return { status: response.status, body: (await response.json()) as never, session };
}

describe('the default admin', () => {
  test('is created once, with a random password written to the log', async () => {
    const password = await startUp();
    expect(password).toMatch(/^[A-Za-z0-9]{24}$/);
    const row = await services.users.findByEmail('admin');
    expect(row).toMatchObject({ role: 'admin', setupRequired: true });
    expect(await startUp()).toBeUndefined();
  });

  test('can do nothing but choose their own email and password', async () => {
    const password = (await startUp()) ?? '';
    const signIn = await call('POST', '/auth/sign-in', { email: 'admin', password });
    expect(signIn.status).toBe(200);
    const cookie = signIn.session;
    expect((await call('GET', '/me', undefined, cookie)).body).toMatchObject({
      principal: { setupRequired: true },
    });
    expect((await call('GET', '/threads', undefined, cookie)).status).toBe(403);
    const setup = { email: 'ada@example.com', name: 'Ada', password: 'short' };
    expect((await call('POST', '/auth/setup', setup, cookie)).status).toBe(400);
    const strong = { ...setup, password: 'violet harbour lantern 3a9c' };
    const done = await call('POST', '/auth/setup', strong, cookie);
    expect(done.status).toBe(200);
    expect((await call('GET', '/threads', undefined, cookie)).status).toBe(401);
    expect((await call('GET', '/threads', undefined, done.session)).status).toBe(200);
    expect((await call('POST', '/auth/sign-in', { email: 'admin', password })).status).toBe(401);
    const again = await call('POST', '/auth/sign-in', {
      email: 'ada@example.com',
      password: strong.password,
    });
    expect(again.status).toBe(200);
    expect((await call('POST', '/auth/setup', strong, again.session)).status).toBe(400);
  });

  test('is not created when an admin exists', async () => {
    await services.users.create({ email: 'ada@example.com', name: 'Ada', role: 'admin' }, 'x');
    expect(await startUp()).toBeUndefined();
    expect(await services.users.findByEmail('admin')).toBeUndefined();
  });

  test('draws a 24-character password from its alphabet', () => {
    const passwords = Array.from({ length: 50 }, generatedPassword);
    for (const password of passwords) expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{24}$/);
    expect(new Set(passwords).size).toBe(50);
  });
});
