import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Principal } from '@quanthea/shared';
import { createAccounts } from '../../accounts.ts';
import { createAuditRepository } from '../../db/audit-repository.ts';
import { openDatabase } from '../../db/database.ts';
import { runMigrations } from '../../db/migrate.ts';
import { createProvisionedRepository } from '../../db/provisioned-repository.ts';
import { createSettingsRepository } from '../../db/settings-repository.ts';
import { createSettingsStore } from '../../settings/settings-store.ts';
import { temporaryDir, testKeyedHashes, testSecretBox } from '../../test/fixtures.ts';
import { inviteLifetimeMs } from '../password-accounts.ts';
import { FlowError } from './provider-flow.ts';
import { type FakePerson, type FakeProvider, startFakeProvider } from './test/fake-provider.ts';

let fake: FakeProvider;
let dataDir: ReturnType<typeof temporaryDir>;
let accounts: ReturnType<typeof createAccounts>;
let database: ReturnType<typeof openDatabase>;
let hashes: Awaited<ReturnType<typeof testKeyedHashes>>;
let clock = Date.parse('2026-09-29T12:00:00Z');
const admin: Principal = { id: 'admin-1', name: 'Root', role: 'admin' };

beforeAll(async () => {
  fake = await startFakeProvider();
});

afterAll(() => fake.stop());

beforeEach(async () => {
  clock = Date.parse('2026-09-29T12:00:00Z');
  fake.misbehave({});
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  const settings = createSettingsStore(createSettingsRepository(database));
  hashes = await testKeyedHashes();
  accounts = createAccounts(
    {
      database,
      settings,
      secretBox: await testSecretBox(),
      ...hashes,
      publicUrl: 'https://quanthea.test',
      driverOptions: { allowHttp: true },
      now: () => clock,
    },
    createAuditRepository(database),
  );
  await accounts.signInSettings.save(
    'gitlab',
    {
      kind: 'gitlab',
      name: 'GitLab',
      baseUrl: fake.issuer,
      tenant: null,
      join: { mode: 'invite', values: [] },
      clientId: fake.clientId,
      clientSecret: fake.clientSecret,
    },
    admin.id,
  );
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * What the configuration file manages, as recorded.
 *
 * @returns The repository.
 */
function provisioned() {
  return createProvisionedRepository(database);
}

/** Ada, as the fake provider knows her. */
const ada: FakePerson = {
  sub: 'ada-1',
  email: 'ada@example.com',
  email_verified: true,
  name: 'Ada',
};

/**
 * The flows, which exist once quanthea has a public URL and sessions.
 *
 * @returns The flows.
 */
function flows() {
  if (!accounts.flows) throw new Error('No flows.');
  return accounts.flows;
}

/**
 * Runs a whole flow: start, the person approving, and the callback.
 *
 * @param person - Who approves at the provider.
 * @param intent - What the flow is for.
 * @param principal - Who is signed in.
 * @returns How it ended, or the flow error.
 */
async function run(
  person: FakePerson,
  intent: 'sign-in' | 'link' | 'test' = 'sign-in',
  principal: Principal | null = null,
) {
  const started = await flows().start({
    providerId: 'gitlab',
    intent,
    next: '/library',
    principal,
  });
  const search = fake.approve(started.location, person);
  return flows()
    .finish({ providerId: 'gitlab', search, flowCookie: started.flowCookie, principal })
    .catch((error: FlowError) => error);
}

/**
 * Invites a person, as an admin does: a user and an invite link.
 *
 * @param email - Their email.
 * @returns The user's id.
 */
async function invite(email = 'ada@example.com'): Promise<string> {
  const user = await accounts.users.create({ email, name: 'Ada', role: 'editor' }, 'x');
  await accounts.passwords?.issueLink(user.id, 'invite', admin.id);
  return user.id;
}

/**
 * Tests the provider and turns it on, as an admin would.
 */
async function enable() {
  expect(await run(ada, 'test', admin)).toEqual({ kind: 'tested' });
  accounts.signInSettings.enable('gitlab', true, admin.id);
}

describe('signing in through a provider', () => {
  test('stays off until a test sign-in succeeds, and asks for PKCE, state and nonce', async () => {
    await expect(
      flows().start({ providerId: 'gitlab', intent: 'sign-in', next: '/', principal: null }),
    ).rejects.toBeInstanceOf(FlowError);
    expect(() => accounts.signInSettings.enable('gitlab', true, admin.id)).toThrow(
      'Test a sign-in',
    );
    await enable();
    const { location } = await flows().start({
      providerId: 'gitlab',
      intent: 'sign-in',
      next: '/',
      principal: null,
    });
    const asked = new URL(location).searchParams;
    expect(asked.get('code_challenge_method')).toBe('S256');
    expect(asked.get('state')?.length).toBeGreaterThan(20);
    expect(asked.get('nonce')?.length).toBeGreaterThan(20);
    expect(asked.get('redirect_uri')).toBe(
      'https://quanthea.test/api/auth/providers/gitlab/callback',
    );
  });

  test('lets in an invited person by their verified email, and links them for next time', async () => {
    await enable();
    const invited = await invite();
    const first = await run(ada);
    expect(first).toMatchObject({ kind: 'signed-in', next: '/library' });
    expect(accounts.identityRows.listOf(invited)).toHaveLength(1);
    const again = await run({ ...ada, email: 'changed@example.com' });
    expect(again).toMatchObject({ kind: 'signed-in' });
  });

  test('refuses someone uninvited, an unverified email, and a disabled user', async () => {
    await enable();
    expect(await run(ada)).toMatchObject({ failure: 'not-invited' });
    await invite();
    expect(await run({ ...ada, email_verified: false })).toMatchObject({ failure: 'not-invited' });
    const user = await accounts.users.findByEmail('ada@example.com');
    accounts.userRows.update(user?.id ?? '', { disabledAt: 1, updatedAt: 1 });
    expect(await run(ada)).toMatchObject({ failure: 'disabled' });
  });

  test('lets in a group or domain as viewers when the join policy says so', async () => {
    const save = (join: { mode: 'group' | 'domain'; values: string[] }) =>
      accounts.signInSettings.save(
        'gitlab',
        { kind: 'gitlab', name: 'GitLab', baseUrl: fake.issuer, tenant: null, join },
        admin.id,
      );
    await save({ mode: 'group', values: ['acme'] });
    await enable();
    expect(await run({ ...ada, groups: ['other'] })).toMatchObject({ failure: 'not-invited' });
    expect(await run({ ...ada, groups: ['acme/platform'] })).toMatchObject({ kind: 'signed-in' });
    expect((await accounts.users.findByEmail('ada@example.com'))?.role).toBe('viewer');
    await save({ mode: 'domain', values: ['example.org'] });
    expect(
      await run({ sub: 'bob-1', email: 'bob@example.org', email_verified: true, name: 'Bob' }),
    ).toMatchObject({ kind: 'signed-in' });
  });

  test('never links an account in use by email; its owner links it signed in', async () => {
    await enable();
    const ada1 = await accounts.users.create(
      { email: 'ada@example.com', name: 'Ada', role: 'editor' },
      'x',
    );
    accounts.userRows.update(ada1.id, { passwordHash: '$argon2id$x', pepperId: 'p', updatedAt: 1 });
    expect(await run(ada)).toMatchObject({ failure: 'link-first' });
    const signedIn: Principal = { id: ada1.id, name: 'Ada', role: 'editor' };
    expect(await run(ada, 'link', signedIn)).toEqual({ kind: 'linked' });
    expect(await run(ada)).toMatchObject({ kind: 'signed-in' });
    const bob: Principal = { id: 'bob', name: 'Bob', role: 'editor' };
    expect(await run(ada, 'link', bob)).toMatchObject({ failure: 'linked-elsewhere' });
  });

  test('refuses a forged or stale ID token: nonce, audience, issuer, key, alg none, expiry', async () => {
    await enable();
    await invite();
    const failureWith = async (misbehaviour: Parameters<FakeProvider['misbehave']>[0]) => {
      fake.misbehave(misbehaviour);
      return ((await run(ada)) as FlowError).failure;
    };
    expect(await failureWith({ nonce: 'someone-elses' })).toBe('provider');
    expect(await failureWith({ audience: 'another-app' })).toBe('provider');
    expect(await failureWith({ foreignKey: true })).toBe('provider');
    expect(await failureWith({ unsigned: true })).toBe('provider');
    expect(await failureWith({ issuer: 'https://evil.test' })).toBe('provider');
    expect(await failureWith({ expired: true })).toBe('provider');
    fake.misbehave({});
    expect(await run(ada)).toMatchObject({ kind: 'signed-in' });
  });

  test('completes a flow once, only in the browser that started it, and only for a while', async () => {
    await enable();
    await invite();
    const started = await flows().start({
      providerId: 'gitlab',
      intent: 'sign-in',
      next: '/',
      principal: null,
    });
    const search = fake.approve(started.location, ada);
    const finish = (flowCookie: string | undefined, query = search) =>
      flows()
        .finish({ providerId: 'gitlab', search: query, flowCookie, principal: null })
        .catch((error: FlowError) => error);
    expect(await finish(undefined)).toMatchObject({ failure: 'expired' });
    const tampered = `${started.flowCookie.slice(0, -4)}AAAA`;
    expect(await finish(tampered)).toMatchObject({ failure: 'expired' });
    const forged = search.replace(/state=[^&]+/, 'state=forged');
    expect(await finish(started.flowCookie, forged)).toMatchObject({ failure: 'provider' });
    const other = await flows().start({
      providerId: 'gitlab',
      intent: 'sign-in',
      next: '/',
      principal: null,
    });
    const code = fake.approve(other.location, ada);
    clock += 11 * 60_000;
    expect(await finish(other.flowCookie, code)).toMatchObject({ failure: 'expired' });
  });

  test('claims an invite only while its link works', async () => {
    await enable();
    await invite();
    clock += inviteLifetimeMs + 1;
    expect(await run(ada)).toMatchObject({ failure: 'not-invited' });
  });

  test('never claims by email a user who signed in before, though they lost every way in', async () => {
    await enable();
    const invited = await invite();
    accounts.userRows.update(invited, { lastSignInAt: clock, updatedAt: clock });
    expect(await run(ada)).toMatchObject({ failure: 'link-first' });
  });

  test('lets in a user the configuration file declares, with no invite link', async () => {
    await enable();
    const declared = await accounts.users.create(
      { email: 'ada@example.com', name: 'Ada', role: 'editor' },
      'quanthea-config',
    );
    expect(await run(ada)).toMatchObject({ failure: 'not-invited' });
    const name = Buffer.from(await hashes.emailIndex.hash('ada@example.com')).toString('hex');
    const record = { kind: 'user' as const, name, path: 'quanthea.yaml', editable: [] };
    provisioned().put({ ...record, fingerprint: new Uint8Array(), appliedAt: clock });
    expect(await run(ada)).toMatchObject({ kind: 'signed-in' });
    expect(accounts.identityRows.listOf(declared.id)).toHaveLength(1);
  });

  test('refuses a sign-in or a link that comes back after the provider was turned off', async () => {
    await enable();
    const invited = await invite();
    const principal: Principal = { id: invited, name: 'Ada', role: 'editor' };
    const started = await Promise.all(
      (['sign-in', 'link'] as const).map((intent) =>
        flows().start({ providerId: 'gitlab', intent, next: '/', principal }),
      ),
    );
    const searches = started.map((each) => fake.approve(each.location, ada));
    accounts.signInSettings.enable('gitlab', false, admin.id);
    for (const [index, each] of started.entries()) {
      const search = searches[index] ?? '';
      const ended = await flows()
        .finish({ providerId: 'gitlab', search, flowCookie: each.flowCookie, principal })
        .catch((error: FlowError) => error);
      expect(ended).toMatchObject({ failure: 'off' });
    }
    expect(accounts.identityRows.listOf(invited)).toHaveLength(0);
  });
  test('refuses a sign-in when the provider is turned off while the code is exchanged', async () => {
    await enable();
    await invite();
    const started = await flows().start({
      providerId: 'gitlab',
      intent: 'sign-in',
      next: '/',
      principal: null,
    });
    const search = fake.approve(started.location, ada);
    const realFetch = globalThis.fetch;
    // The admin turns the provider off while quanthea waits on the provider's token endpoint.
    globalThis.fetch = Object.assign((...input: Parameters<typeof fetch>) => {
      if (String(input[0] instanceof Request ? input[0].url : input[0]).endsWith('/token'))
        accounts.signInSettings.enable('gitlab', false, admin.id);
      return realFetch(...input);
    }, realFetch);
    const ended = await flows()
      .finish({ providerId: 'gitlab', search, flowCookie: started.flowCookie, principal: null })
      .catch((error: FlowError) => error)
      .finally(() => {
        globalThis.fetch = realFetch;
      });
    expect(ended).toMatchObject({ failure: 'off' });
  });
});
