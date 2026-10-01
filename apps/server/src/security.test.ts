import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectorInputSchema, defaultModelGateway } from '@quanthea/shared';
import { type FakeProvider, startFakeProvider } from './auth/providers/test/fake-provider.ts';
import { temporaryDir, testServices } from './test/fixtures.ts';

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
    publicUrl: 'https://quanthea.test',
    driverOptions: { allowHttp: true },
  });
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** Values that must never reach the database file in clear. */
const secrets = {
  connectorToken: 'tok-connector-5e1b77',
  modelKey: 'sk-model-key-5e1b77',
  email: 'grace.hopper.5e1b@example.com',
  name: 'Grace Brewster Hopper',
  password: 'violet harbour lantern 5e1b',
  providerEmail: 'ada.lovelace.5e1b@example.com',
  providerName: 'Augusta Ada King',
  subject: 'subject-ada-5e1b77',
};

/**
 * Stores a connector credential, a model key, and a user with a password.
 *
 * @returns The invite token and the session id, which must not be stored in clear either.
 */
async function storeLocalSecrets(): Promise<string[]> {
  const connector = { name: 'events', kind: 'memory', config: {} };
  const secret = { token: secrets.connectorToken };
  await services.connections.create(connectorInputSchema.parse({ ...connector, secret }), 'x');
  const providerId = defaultModelGateway.defaultProviderId;
  await services.modelSettings.save(defaultModelGateway, { [providerId]: secrets.modelKey }, 'x');
  const user = await services.users.create(
    { email: secrets.email, name: secrets.name, role: 'admin' },
    'x',
  );
  const passwords = services.passwords;
  if (!passwords) throw new Error('The test services have no passwords.');
  const { token } = await passwords.issueLink(user.id, 'invite', 'x');
  const address = '127.0.0.1';
  const { cookie } = await passwords.setWithLink({ token, password: secrets.password, address });
  return [token, cookie.split('.')[0] ?? cookie];
}

/**
 * Stores provider credentials, and a person linked through the provider, signed in.
 *
 * @returns The provider's client id and secret and the session id.
 */
async function storeProviderSecrets(): Promise<string[]> {
  const join = { mode: 'invite' as const, values: [] };
  const { clientId, clientSecret } = fake;
  const provider = { kind: 'gitlab' as const, name: 'GitLab', tenant: null, join };
  const settings = services.signInSettings;
  await settings.save('gitlab', { ...provider, baseUrl: fake.issuer, clientId, clientSecret }, 'x');
  settings.markTested('gitlab', 'x');
  settings.enable('gitlab', true, 'x');
  const person = { email: secrets.providerEmail, name: secrets.providerName, role: 'editor' };
  await services.users.create(person as Parameters<typeof services.users.create>[0], 'x');
  const flows = services.flows;
  if (!flows) throw new Error('The test services have no provider flows.');
  const intent = 'sign-in' as const;
  const started = await flows.start({ providerId: 'gitlab', intent, next: '/', principal: null });
  const search = fake.approve(started.location, {
    sub: secrets.subject,
    email: secrets.providerEmail,
    email_verified: true,
    name: secrets.providerName,
  });
  const flowCookie = started.flowCookie;
  const outcome = await flows.finish({ providerId: 'gitlab', search, flowCookie, principal: null });
  if (outcome.kind !== 'signed-in') throw new Error('The provider sign-in failed.');
  return [clientId, clientSecret, outcome.cookie.split('.')[0] ?? outcome.cookie];
}

describe('a stolen database', () => {
  test('holds no secret, password, token, session, name, email or provider id in clear', async () => {
    const values = [
      ...Object.values(secrets),
      ...(await storeLocalSecrets()),
      ...(await storeProviderSecrets()),
    ];
    // A thief copies the database with its write-ahead log and shared memory.
    const files = ['quanthea.db', 'quanthea.db-wal', 'quanthea.db-shm']
      .map((file) => join(dataDir.path, file))
      .filter((path) => existsSync(path));
    expect(files.length).toBeGreaterThan(1);
    for (const path of files) {
      const bytes = readFileSync(path);
      const found = values.filter((value) => bytes.includes(Buffer.from(value)));
      expect({ path, found }).toEqual({ path, found: [] });
    }
  });
});
