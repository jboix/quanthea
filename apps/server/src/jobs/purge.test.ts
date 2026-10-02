import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { captureLogs, temporaryDir, testServices } from '../test/fixtures.ts';
import { purgeExpired, purgeSnapshots } from './purge.ts';

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

/**
 * Runs the job at a time.
 *
 * @param now - The time.
 * @returns How many threads it purged.
 */
function runAt(now: number): number {
  const { logger } = captureLogs();
  return purgeExpired({ bin: services.bin, retention: services.retention, logger, now: () => now });
}

describe('the purge job', () => {
  test('purges threads binned longer ago than the retention allows', () => {
    const thread = services.threads.create('editor-1');
    services.bin.bin(thread.id, 'editor-1');
    const binnedAt = services.bin.list()[0]?.deletedAt ?? 0;
    expect(runAt(binnedAt + 29 * 86_400_000)).toBe(0);
    expect(runAt(binnedAt + 30 * 86_400_000)).toBe(1);
    expect(services.bin.list()).toEqual([]);
  });

  test('purges at once with 0 days, and never when the bin keeps threads', () => {
    const thread = services.threads.create('editor-1');
    services.bin.bin(thread.id, 'editor-1');
    services.retention.save({ binDays: null }, 'admin-1');
    expect(runAt(Date.now() + 3650 * 86_400_000)).toBe(0);
    services.retention.save({ binDays: 0 }, 'admin-1');
    expect(runAt(Date.now())).toBe(1);
  });

  test('deletes the snapshots whose time is up, and says how many', () => {
    const { logger, lines } = captureLogs();
    const snapshots = { purgeExpired: () => 2 };
    const dependencies = { bin: services.bin, retention: services.retention, snapshots, logger };
    expect(purgeSnapshots(dependencies)).toBe(2);
    expect(JSON.stringify(lines)).toContain('purged expired snapshots');
  });
});
