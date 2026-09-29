import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectorInputSchema, defaultModelGateway } from '@querent/shared';
import { readConfigFile } from '../config/config-file.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createProvisionedRepository } from '../db/provisioned-repository.ts';
import { keyedHash } from '../secrets/keyed-hash.ts';
import { captureLogs, temporaryDir, testServices } from '../test/fixtures.ts';
import { exportConfiguration } from './export.ts';
import { provision } from './provision.ts';

let directories: ReturnType<typeof temporaryDir>[];
let source: Awaited<ReturnType<typeof testServices>>;
let target: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  directories = [temporaryDir(), temporaryDir(), temporaryDir()];
  source = await testServices(directories[0]?.path ?? '');
  target = await testServices(directories[1]?.path ?? '');
});

afterEach(async () => {
  await source.close();
  await target.close();
  for (const directory of directories) directory.remove();
});

/** An empty server section, as when every system setting is a default. */
const noServer = { configFiles: [], settings: [], keys: [] };

/**
 * Sets up the source install through its services, as an admin would in the interface.
 *
 * @returns Once it is set up.
 */
async function setUpSource(): Promise<void> {
  const connector = { name: 'events', kind: 'memory', config: { rowCount: 3 } };
  const secret = { token: 'connector-secret-4e7f' };
  await source.connections.create(connectorInputSchema.parse({ ...connector, secret }), 'x');
  const providerId = defaultModelGateway.defaultProviderId;
  await source.modelSettings.save(defaultModelGateway, { [providerId]: 'model-key-4e7f' }, 'x');
  source.retention.save({ binDays: 11 }, 'x');
  await source.users.create({ email: 'ada@example.com', name: 'Ada', role: 'admin' }, 'x');
  const github = { kind: 'github' as const, name: 'GitHub', baseUrl: null, tenant: null };
  const join = { mode: 'invite' as const, values: [] };
  await source.signInSettings.save(
    'github',
    { ...github, join, clientId: 'Iv1.4e7f', clientSecret: 'gh-4e7f' },
    'x',
  );
}

describe('exporting the configuration', () => {
  test('writes a file with references for secrets, which rebuilds the same install', async () => {
    await setUpSource();
    const yaml = await exportConfiguration(source, noServer);
    for (const secret of ['connector-secret-4e7f', 'model-key-4e7f', 'gh-4e7f', 'Iv1.4e7f'])
      expect(yaml).not.toContain(secret);
    const names = [...yaml.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((match) => match[1] ?? '');
    expect(names.sort()).toEqual([
      'CONNECTOR_EVENTS_TOKEN',
      'MODEL_ANTHROPIC_API_KEY',
      'SIGN_IN_GITHUB_CLIENT_ID',
      'SIGN_IN_GITHUB_CLIENT_SECRET',
    ]);
    const path = join(directories[2]?.path ?? '', 'querent.yaml');
    writeFileSync(path, yaml);
    const environment = Object.fromEntries(
      names.map((name) => [name, `${name.toLowerCase()}-value`]),
    );
    await provision({
      file: readConfigFile(path, environment),
      repository: createProvisionedRepository(target.database),
      fingerprints: await keyedHash(new Uint8Array(32).fill(5), 'test'),
      emailIndex: target.hashes.emailIndex,
      peppers: target.hashes.peppers,
      services: target,
      audit: createAuditRepository(target.database),
      logger: captureLogs().logger,
    });
    expect(target.connections.list()).toMatchObject([{ name: 'events', kind: 'memory' }]);
    expect(target.retention.get().binDays).toBe(11);
    expect((await target.users.findByEmail('ada@example.com'))?.role).toBe('admin');
    expect((await target.modelSettings.resolve()).apiKey).toBe('model_anthropic_api_key-value');
    expect(target.signInSettings.view().providers).toMatchObject([
      { id: 'github', kind: 'github' },
    ]);
  });
});
