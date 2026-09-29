import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigFile } from '../config/config-file.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createProvisionedRepository } from '../db/provisioned-repository.ts';
import { keyedHash } from '../secrets/keyed-hash.ts';
import { captureLogs, temporaryDir, testServices } from '../test/fixtures.ts';
import { provision } from './provision.ts';
import { createProvisioningStatus } from './status.ts';
import { applyChange, watchConfig } from './watch.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let configDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  configDir = temporaryDir();
  services = await testServices(dataDir.path);
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
  configDir.remove();
});

/**
 * What watching needs, over the test services.
 *
 * @returns The dependencies and the status.
 */
async function watching() {
  const fingerprints = await keyedHash(new Uint8Array(32).fill(3), 'test');
  const apply = (file: ConfigFile) =>
    provision({
      file,
      repository: createProvisionedRepository(services.database),
      fingerprints,
      emailIndex: services.hashes.emailIndex,
      peppers: services.hashes.peppers,
      services,
      audit: createAuditRepository(services.database),
      logger: captureLogs().logger,
    });
  const status = createProvisioningStatus();
  const dependencies = {
    path: configDir.path,
    environment: {},
    startupServer: { port: 3000 },
    apply,
    status,
    logger: captureLogs().logger,
    intervalMs: 20,
  };
  return { dependencies, status };
}

/**
 * Writes the configuration file.
 *
 * @param yaml - Its content.
 */
function write(yaml: string): void {
  writeFileSync(join(configDir.path, 'querent.yaml'), yaml);
}

describe('a changed configuration file', () => {
  test('applies, and names the system settings that wait for a restart', async () => {
    const { dependencies, status } = await watching();
    write('server:\n  port: 8080\nretention:\n  binDays: 9\n');
    await applyChange(dependencies);
    expect(services.retention.get().binDays).toBe(9);
    expect(status.problem()).toBeNull();
    expect(status.restartNeeded()).toEqual(['port']);
  });

  test('that is wrong keeps the last good configuration, and says why', async () => {
    const { dependencies, status } = await watching();
    write('retention:\n  binDays: 9\n');
    await applyChange(dependencies);
    write('retention:\n  binDays: -1\n');
    await applyChange(dependencies);
    expect(services.retention.get().binDays).toBe(9);
    expect(status.problem()).toContain('retention.binDays');
    write('retention:\n  binDays: 12\n');
    await applyChange(dependencies);
    expect(status.problem()).toBeNull();
  });

  test('is noticed without a restart', async () => {
    const { dependencies } = await watching();
    const stop = watchConfig(dependencies);
    write('retention:\n  binDays: 21\n');
    for (let tries = 0; tries < 50 && services.retention.get().binDays !== 21; tries += 1)
      await Bun.sleep(20);
    stop();
    expect(services.retention.get().binDays).toBe(21);
  });
});
