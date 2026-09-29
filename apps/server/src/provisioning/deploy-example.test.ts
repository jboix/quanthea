import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadConfig } from '../config/config.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createProvisionedRepository } from '../db/provisioned-repository.ts';
import { keyedHash } from '../secrets/keyed-hash.ts';
import { captureLogs, temporaryDir, testServices } from '../test/fixtures.ts';
import { provision } from './provision.ts';

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

describe('deploy/querent.yaml', () => {
  test('starts an install with its admin and its model provider', async () => {
    const environment = {
      QUERENT_CONFIG: resolve(import.meta.dir, '../../../../deploy/querent.yaml'),
      ADMIN_PASSWORD: 'violet harbour lantern 7c2e',
      ANTHROPIC_API_KEY: 'not-a-real-key-7c2e',
    };
    const config = loadConfig(environment, '/app');
    expect(config).toMatchObject({
      publicUrl: 'http://localhost:3000',
      authModeOverride: 'accounts',
    });
    await provision({
      file: config.file ?? { paths: [], sections: {}, raw: {}, origins: {} },
      repository: createProvisionedRepository(services.database),
      fingerprints: await keyedHash(new Uint8Array(32).fill(9), 'test'),
      emailIndex: services.hashes.emailIndex,
      peppers: services.hashes.peppers,
      services,
      audit: createAuditRepository(services.database),
      logger: captureLogs().logger,
    });
    const admin = await services.users.findByEmail('admin@example.com');
    expect(admin).toMatchObject({ role: 'admin' });
    expect(admin?.passwordHash).toStartWith('$argon2id$');
    expect((await services.modelSettings.resolve()).apiKey).toBe('not-a-real-key-7c2e');
  });
});
