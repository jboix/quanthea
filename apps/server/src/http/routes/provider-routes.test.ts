import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { providerFlowFailures, providerStartPath } from '@quanthea/shared';
import { createApp } from '../../app.ts';
import { createAuthenticator, sessionCookieName } from '../../auth/authenticator.ts';
import { type FakeProvider, startFakeProvider } from '../../auth/providers/test/fake-provider.ts';
import { captureLogs, temporaryDir, testServices } from '../../test/fixtures.ts';

let fake: FakeProvider;
let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeAll(async () => {
  fake = await startFakeProvider();
});

afterAll(() => fake.stop());

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path, undefined, undefined, {
    publicUrl: 'https://querent.test',
    driverOptions: { allowHttp: true },
  });
  const join = { mode: 'invite' as const, values: [] };
  const { clientId, clientSecret } = fake;
  const provider = { kind: 'gitlab' as const, name: 'GitLab', tenant: null, join };
  await services.signInSettings.save(
    'gitlab',
    { ...provider, baseUrl: fake.issuer, clientId, clientSecret },
    'admin',
  );
  services.signInSettings.markTested('gitlab', 'admin');
  services.signInSettings.enable('gitlab', true, 'admin');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** Ada, as the fake provider knows her. */
const ada = { sub: 'ada-1', email: 'ada@example.com', email_verified: true, name: 'Ada' };

/**
 * Sends a GET to the real app in accounts mode.
 *
 * @param path - The path, from the origin.
 * @param cookie - The cookie header, if any.
 * @returns The status, where it redirects, and the cookies it sets.
 */
async function get(path: string, cookie?: string) {
  const sessions = services.sessions;
  if (!sessions) throw new Error('The test services have no sessions.');
  const app = createApp({
    version: 'test',
    authenticator: createAuthenticator({ sessions, users: services.users }),
    logger: captureLogs().logger,
    webDir: dataDir.path,
    trustedProxyHops: 0,
    ...services,
    publicUrl: 'https://querent.test',
  });
  const headers = cookie ? { cookie } : undefined;
  const response = await app.request(`https://querent.test${path}`, { headers });
  const cookies = response.headers.getSetCookie();
  return { status: response.status, location: response.headers.get('location') ?? '', cookies };
}

/**
 * A cookie's value among the ones a response sets.
 *
 * @param cookies - The `Set-Cookie` headers.
 * @param name - The cookie.
 * @returns Its `name=value` pair, or `undefined`.
 */
function cookieOf(cookies: readonly string[], name: string): string | undefined {
  return cookies.find((each) => each.startsWith(`${name}=`))?.split(';')[0];
}

describe('provider sign-in routes', () => {
  test('sign an invited person in, with hardened cookies, and go where they were headed', async () => {
    await services.users.create({ email: ada.email, name: 'Ada', role: 'editor' }, 'admin');
    const start = await get(providerStartPath('gitlab', 'sign-in', '/library'));
    expect(start.status).toBe(302);
    expect(start.location).toStartWith(`${fake.issuer}/authorize?`);
    const flowCookie = start.cookies.find((each) => each.startsWith('__Host-querent_flow='));
    expect(flowCookie).toMatch(/Max-Age=600/);
    expect(flowCookie).toMatch(/Secure/);
    expect(flowCookie).toMatch(/HttpOnly/);
    expect(flowCookie).toMatch(/SameSite=Lax/);
    const query = fake.approve(start.location, ada);
    const callback = await get(
      `/api/auth/providers/gitlab/callback${query}`,
      cookieOf(start.cookies, '__Host-querent_flow'),
    );
    expect(callback.status).toBe(302);
    expect(callback.location).toBe('/library');
    expect(callback.cookies.join('\n')).toMatch(/__Host-querent_flow=;.*Max-Age=0/);
    const session = cookieOf(callback.cookies, sessionCookieName);
    expect(session).toBeDefined();
    const again = await get(
      `/api/auth/providers/gitlab/callback${query}`,
      cookieOf(start.cookies, '__Host-querent_flow'),
    );
    expect(again.location).toBe('/login?error=provider');
  });

  test('send failures to a fixed page with a known code, never what the request carried', async () => {
    const noCookie = await get('/api/auth/providers/gitlab/callback?code=x&state=y');
    expect(noCookie.location).toBe('/login?error=expired');
    const reflected = await get(
      '/api/auth/providers/gitlab/callback?error=%3Cscript%3E&error_description=evil',
    );
    expect(reflected.location).toBe('/login?error=expired');
    const unknown = await get(providerStartPath('nobody', 'sign-in'));
    expect(unknown.location).toMatch(/^\/login\?error=[a-z-]+$/);
    const test = await get(providerStartPath('gitlab', 'test'));
    expect(test.location).toMatch(/^\/settings\/auth\?error=[a-z-]+$/);
    for (const page of [noCookie, reflected, unknown, test]) {
      const code = new URL(page.location, 'https://querent.test').searchParams.get('error') ?? '';
      expect(Object.keys(providerFlowFailures)).toContain(code);
    }
  });

  test('go home, not to another site, after signing in', async () => {
    await services.users.create({ email: ada.email, name: 'Ada', role: 'editor' }, 'admin');
    const start = await get(providerStartPath('gitlab', 'sign-in', '//evil.test/x'));
    const query = fake.approve(start.location, ada);
    const callback = await get(
      `/api/auth/providers/gitlab/callback${query}`,
      cookieOf(start.cookies, '__Host-querent_flow'),
    );
    expect(callback.location).toBe('/');
  });
});
