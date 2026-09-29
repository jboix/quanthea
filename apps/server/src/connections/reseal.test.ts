import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelGateway } from '@querent/shared';
import { memoryConnector } from '../connectors/_shared/test/memory-connector.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createConnectorRepository } from '../db/connector-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { createSettingsRepository } from '../db/settings-repository.ts';
import { openSecretBox } from '../secrets/secret-box.ts';
import { resealSecrets } from '../services.ts';
import { createModelSettings } from '../settings/model-settings.ts';
import { createSettingsStore } from '../settings/settings-store.ts';
import { temporaryDir } from '../test/fixtures.ts';
import { createConnections } from './connections.ts';

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

    const rotating = await openSecretBox(newKey, oldKey);
    expect(await resealSecrets({ database, secretBox: rotating, settings })).toBe(2);
    expect(await resealSecrets({ database, secretBox: rotating, settings })).toBe(0);

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
  });
});
