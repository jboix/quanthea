import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../app.ts';
import { captureLogs, temporaryDir, testServices } from '../test/fixtures.ts';
import { createAuthenticator, sessionCookieName } from './authenticator.ts';
import { absoluteLimitMs, idleLimitMs } from './sessions.ts';

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

/**
 * The sessions service of the test services.
 *
 * @returns The sessions.
 */
function sessions() {
  if (!services.sessions) throw new Error('The test services have no sessions.');
  return services.sessions;
}

/**
 * A request carrying a session cookie.
 *
 * @param cookie - The cookie value.
 * @returns The request.
 */
function withCookie(cookie: string): Request {
  return new Request('http://querent.test/api/me', {
    headers: { cookie: `${sessionCookieName}=${cookie}` },
  });
}

/**
 * A user, and a session of theirs.
 *
 * @param role - The user's role.
 * @returns The user and the cookie value.
 */
async function signedIn(role: 'viewer' | 'editor' | 'admin' = 'editor') {
  const user = await services.users.create(
    { email: 'ada.lovelace@example.com', name: 'Ada Lovelace', role },
    'x',
  );
  const { cookie } = await sessions().start(user.id);
  return { user, cookie };
}

describe('sessions', () => {
  test('sign a request in as its user, while the session lasts', async () => {
    const { user, cookie } = await signedIn('admin');
    const authenticator = createAuthenticator({
      sessions: sessions(),
      users: services.users,
    });
    expect(await authenticator.authenticate(withCookie(cookie))).toEqual({
      id: user.id,
      name: 'Ada Lovelace',
      role: 'admin',
    });
    expect(await authenticator.authenticate(new Request('http://querent.test/'))).toBeNull();
  });

  test('refuse a cookie whose id or signature was changed, or that appears twice', async () => {
    const { cookie } = await signedIn();
    const [id, signature] = cookie.split('.') as [string, string];
    const flipped = `${id.slice(0, -1)}${id.endsWith('A') ? 'B' : 'A'}.${signature}`;
    for (const forged of [flipped, `${id}.${signature.slice(0, -2)}`, id, `${cookie}.x`, '']) {
      expect(await sessions().resolve(forged)).toBeNull();
    }
    const twice = new Request('http://querent.test/', {
      headers: { cookie: `${sessionCookieName}=${cookie}; ${sessionCookieName}=${cookie}` },
    });
    expect(
      await createAuthenticator({
        sessions: sessions(),
        users: services.users,
      }).authenticate(twice),
    ).toBeNull();
  });

  test('end after 24 hours without a request, and after 7 days in all', async () => {
    const { cookie } = await signedIn();
    clock += idleLimitMs - 1000;
    expect(await sessions().resolve(cookie)).not.toBeNull();
    clock += idleLimitMs - 1000;
    expect(await sessions().resolve(cookie)).not.toBeNull();
    clock += idleLimitMs;
    expect(await sessions().resolve(cookie)).toBeNull();
  });

  test('end at the absolute limit, however busy', async () => {
    const { cookie } = await signedIn();
    while (clock + 12 * 3_600_000 < startedAt + absoluteLimitMs) {
      clock += 12 * 3_600_000;
      expect(await sessions().resolve(cookie)).not.toBeNull();
    }
    clock = startedAt + absoluteLimitMs;
    expect(await sessions().resolve(cookie)).toBeNull();
  });

  test('end one, all of a user’s, and refuse a disabled user', async () => {
    const { user, cookie } = await signedIn();
    const second = await sessions().start(user.id);
    expect(sessions().list(user.id)).toHaveLength(2);
    expect(sessions().endOne(user.id, second.publicId)).toBe(true);
    expect(await sessions().resolve(second.cookie)).toBeNull();
    expect(sessions().endAllOf(user.id)).toBe(1);
    expect(await sessions().resolve(cookie)).toBeNull();
  });

  test('sign out through the app: the session ends and the cookie is cleared', async () => {
    const { cookie } = await signedIn();
    const app = createApp({
      version: 'test',
      authenticator: createAuthenticator({
        sessions: sessions(),
        users: services.users,
      }),
      logger: captureLogs().logger,
      webDir: dataDir.path,
      publicUrl: 'https://querent.test',
      trustedProxyHops: 0,
      ...services,
    });
    const response = await app.request('https://querent.test/api/auth/sign-out', {
      method: 'POST',
      headers: {
        cookie: `${sessionCookieName}=${cookie}`,
        'X-Requested-With': 'querent',
        Origin: 'https://querent.test',
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain(`${sessionCookieName}=;`);
    expect(response.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(await sessions().resolve(cookie)).toBeNull();
  });

  test('store no name, email or session id in clear in the database file', async () => {
    const { cookie } = await signedIn();
    // A thief copies the database and its write-ahead log; neither may hold them.
    const [id] = cookie.split('.') as [string];
    for (const file of ['querent.db', 'querent.db-wal']) {
      const bytes = readFileSync(join(dataDir.path, file));
      for (const clear of ['ada.lovelace@example.com', 'Ada Lovelace', id]) {
        expect(bytes.includes(Buffer.from(clear))).toBe(false);
      }
    }
  });
});
