import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureLogs, temporaryDir } from '../test/fixtures.ts';
import { createSecretBox } from './secret-box.ts';
import { loadSecretKey } from './secret-key.ts';

let dataDir: ReturnType<typeof temporaryDir>;

beforeEach(() => {
  dataDir = temporaryDir();
});

afterEach(() => dataDir.remove());

describe('loadSecretKey', () => {
  test('generates a key file with mode 0600 and warns once', async () => {
    const { logger, lines } = captureLogs();
    await loadSecretKey({ configuredKey: undefined, dataDir: dataDir.path, logger });
    const path = join(dataDir.path, 'secret.key');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(Buffer.from(readFileSync(path, 'utf8').trim(), 'base64').length).toBe(32);
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', path }));
  });

  test('reuses the key file, so values sealed before a restart still open', async () => {
    const { logger } = captureLogs();
    const before = createSecretBox(
      await loadSecretKey({ configuredKey: undefined, dataDir: dataDir.path, logger }),
    );
    const sealed = await before.seal('s3cret', 'connector-1');
    const after = createSecretBox(
      await loadSecretKey({ configuredKey: undefined, dataDir: dataDir.path, logger }),
    );
    expect(await after.open(sealed, 'connector-1')).toBe('s3cret');
  });

  test('prefers QUERENT_SECRET_KEY and creates no file', async () => {
    const { logger, lines } = captureLogs();
    const configuredKey = Buffer.alloc(32, 7).toString('base64');
    await loadSecretKey({ configuredKey, dataDir: dataDir.path, logger });
    expect(() => statSync(join(dataDir.path, 'secret.key'))).toThrow();
    expect(lines).toEqual([]);
  });

  test('rejects a key that is not 32 bytes', async () => {
    const { logger } = captureLogs();
    const configuredKey = Buffer.alloc(16).toString('base64');
    await expect(loadSecretKey({ configuredKey, dataDir: dataDir.path, logger })).rejects.toThrow(
      'QUERENT_SECRET_KEY must be 32 bytes in base64',
    );
  });

  test('rejects a damaged key file', async () => {
    const { logger } = captureLogs();
    writeFileSync(join(dataDir.path, 'secret.key'), 'short\n');
    await expect(
      loadSecretKey({ configuredKey: undefined, dataDir: dataDir.path, logger }),
    ).rejects.toThrow('must be 32 bytes in base64');
  });
});
