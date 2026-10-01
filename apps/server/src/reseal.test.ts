import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelGateway } from '@quanthea/shared';
import { createSignInSettings } from './auth/providers/sign-in-settings.ts';
import { createUsers } from './auth/users.ts';
import { createConnections } from './connections/connections.ts';
import { memoryConnector } from './connectors/_shared/test/memory-connector.ts';
import { createAuditRepository } from './db/audit-repository.ts';
import { createConnectorRepository } from './db/connector-repository.ts';
import { openDatabase } from './db/database.ts';
import { createIdentityRepository } from './db/identity-repository.ts';
import { runMigrations } from './db/migrate.ts';
import { createSettingsRepository } from './db/settings-repository.ts';
import { createUserRepository } from './db/user-repository.ts';
import { keyedHash } from './secrets/keyed-hash.ts';
import { openSecretBox } from './secrets/secret-box.ts';
import { resealSecrets } from './services.ts';
import { createModelSettings } from './settings/model-settings.ts';
import { createSettingsStore } from './settings/settings-store.ts';
import { temporaryDir } from './test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * A fresh random 32-byte key.
 *
 * @returns The key.
 */
function randomKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

describe('sealing secrets again', () => {
  test('moves every secret to the new key, so the old one can be dropped', async () => {
    const oldKey = randomKey();
    const newKey = randomKey();
    const settings = createSettingsStore(createSettingsRepository(database));
    const audit = createAuditRepository(database);
    const before = await openSecretBox(oldKey);
    const repository = createConnectorRepository(database);
    const connections = createConnections({
      kinds: [memoryConnector],
      repository,
      audit,
      secretBox: before,
    });
    const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 'tok-9f2a' } };
    const { id } = await connections.create(connectorInputSchema.parse(input), 'admin-1');
    const models = createModelSettings({
      store: settings,
      secretBox: before,
      audit,
      usage: () => ({ tokens: 0, threads: 0, pinnedViews: 0, dollars: 0 }),
    });
    const providerId = defaultModelGateway.defaultProviderId;
    await models.save(defaultModelGateway, { [providerId]: 'sk-a-model-key-9f2a' }, 'admin-1');

    const oldIndex = await keyedHash(oldKey, 'quanthea/email-index/v1');
    const newIndex = await keyedHash(newKey, 'quanthea/email-index/v1');
    const userRepository = createUserRepository(database);
    const users = createUsers({
      repository: userRepository,
      secretBox: before,
      emailIndex: oldIndex,
      audit,
    });
    const ada = await users.create({ email: 'Ada@Example.com', name: 'Ada', role: 'admin' }, 'x');

    const rotating = await openSecretBox(newKey, oldKey);
    const reseal = () =>
      resealSecrets({ database, secretBox: rotating, settings, emailIndex: newIndex });
    const signIn = createSignInSettings({
      store: settings,
      secretBox: before,
      identities: createIdentityRepository(database),
      users: userRepository,
      publicUrl: 'https://quanthea.test',
      audit,
    });
    const github = { kind: 'github' as const, name: 'GitHub', baseUrl: null, tenant: null };
    const join = { mode: 'invite' as const, values: [] };
    await signIn.save('github', { ...github, join, clientId: 'Iv1', clientSecret: 'gh-9f2a' }, 'x');
    expect(await reseal()).toBe(4);
    expect(await reseal()).toBe(0);

    const after = await openSecretBox(newKey);
    const row = repository.get(id);
    expect(JSON.parse(await after.open(row?.secret ?? new Uint8Array(), id))).toEqual({
      token: 'tok-9f2a',
    });
    const reopened = createModelSettings({
      store: settings,
      secretBox: after,
      audit,
      usage: () => ({ tokens: 0, threads: 0, pinnedViews: 0, dollars: 0 }),
    });
    expect((await reopened.resolve(providerId)).apiKey).toBe('sk-a-model-key-9f2a');
    const found = createUsers({
      repository: userRepository,
      secretBox: after,
      emailIndex: newIndex,
      audit,
    });
    expect((await found.findByEmail(' ada@example.com'))?.id).toBe(ada.id);
    expect(await found.get(ada.id)).toMatchObject({ email: 'Ada@Example.com', name: 'Ada' });
    const reopenedSignIn = createSignInSettings({
      store: settings,
      secretBox: after,
      identities: createIdentityRepository(database),
      users: userRepository,
      publicUrl: 'https://quanthea.test',
      audit,
    });
    expect(await reopenedSignIn.credentials('github')).toEqual({
      clientId: 'Iv1',
      clientSecret: 'gh-9f2a',
    });
  });
});
