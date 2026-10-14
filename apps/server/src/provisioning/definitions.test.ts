import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfigFile } from '../config/config-file.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createProvisionedRepository } from '../db/provisioned-repository.ts';
import { keyedHash } from '../secrets/keyed-hash.ts';
import { captureLogs, temporaryDir, testServices } from '../test/fixtures.ts';
import { provision } from './provision.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let configDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let path: string;

beforeEach(async () => {
  dataDir = temporaryDir();
  configDir = temporaryDir();
  services = await testServices(dataDir.path);
  path = join(configDir.path, 'quanthea.yaml');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
  configDir.remove();
});

/**
 * Writes the file and applies it.
 *
 * @param yaml - The file's content.
 * @returns Once it is applied.
 */
async function apply(yaml: string): Promise<void> {
  writeFileSync(path, yaml);
  await provision({
    file: readConfigFile(path, {}),
    repository: createProvisionedRepository(services.database),
    fingerprints: await keyedHash(new Uint8Array(32).fill(7), 'test'),
    emailIndex: services.hashes.emailIndex,
    peppers: services.hashes.peppers,
    services,
    audit: createAuditRepository(services.database),
    logger: captureLogs().logger,
  });
}

/**
 * A file declaring the sessions definition.
 *
 * @param meaning - Its meaning.
 * @returns The YAML.
 */
const sessions = (meaning: string) =>
  `definitions:\n  sessions:\n    name: Sessions\n    meaning: ${meaning}\n`;

/**
 * The versions of the sessions definition, the latest first.
 *
 * @returns Each version's number, meaning and origin.
 */
function versions() {
  return services.definitions.history('sessions').map((each) => ({
    version: each.version,
    meaning: each.definition.meaning,
    origin: each.origin,
  }));
}

describe('provisioning definitions', () => {
  test('adds a version when the file changes, none when it does not, and manages it', async () => {
    await apply(sessions('One playback.'));
    await apply(sessions('One playback.'));
    await apply(sessions('One playback, counted once.'));
    expect(versions()).toEqual([
      { version: 2, meaning: 'One playback, counted once.', origin: 'file' },
      { version: 1, meaning: 'One playback.', origin: 'file' },
    ]);
    expect(services.managed.pathOf('definition', 'sessions')).toBe(path);
  });

  test('deletes what the file no longer declares with prune, and refuses an invalid one', async () => {
    await apply(sessions('One playback.'));
    await apply('provisioning:\n  prune: true\n');
    expect(services.definitions.list()).toEqual([]);
    await expect(apply('definitions:\n  sessions:\n    name: Sessions\n')).rejects.toThrow(
      'definitions.sessions.meaning',
    );
  });
});
