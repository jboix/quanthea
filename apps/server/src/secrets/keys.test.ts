import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureLogs, temporaryDir } from '../test/fixtures.ts';
import { type KeyInput, type KeyInputs, loadKeys } from './keys.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let outside: ReturnType<typeof temporaryDir>;

beforeEach(() => {
  dataDir = temporaryDir();
  outside = temporaryDir();
});

afterEach(() => {
  dataDir.remove();
  outside.remove();
});

/**
 * A fresh random key in base64.
 *
 * @returns The key.
 */
function randomKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
}

/**
 * Key inputs with some variables set.
 *
 * @param set - The variables and files set, by field.
 * @returns The inputs.
 */
function inputs(set: Partial<Record<keyof KeyInputs, Partial<KeyInput>>> = {}): KeyInputs {
  const names = {
    secret: 'QUERENT_SECRET_KEY',
    secretPrevious: 'QUERENT_SECRET_KEY_PREVIOUS',
    session: 'QUERENT_SESSION_KEY',
    pepper: 'QUERENT_PASSWORD_PEPPER',
    pepperPrevious: 'QUERENT_PASSWORD_PEPPER_PREVIOUS',
  };
  const entries = Object.entries(names).map(([field, name]) => [
    field,
    { name, value: undefined, file: undefined, ...set[field as keyof KeyInputs] },
  ]);
  return Object.fromEntries(entries) as KeyInputs;
}

/**
 * Loads the keys into the test data directory.
 *
 * @param keys - The key inputs.
 * @returns The key ring and the log lines.
 */
async function load(keys: KeyInputs) {
  const { logger, lines } = captureLogs();
  return { ring: await loadKeys({ keys, dataDir: dataDir.path, logger }), lines };
}

describe('loading the keys', () => {
  test('generates a secret key file with mode 0600 in none mode, and says where it lives', async () => {
    const { ring, lines } = await load(inputs());
    const path = join(dataDir.path, 'secret.key');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(Buffer.from(readFileSync(path, 'utf8').trim(), 'base64').length).toBe(32);
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', path }));
    expect(ring.secretKeyOrigin).toBe('data-dir');
    const again = await load(inputs());
    const sealed = await ring.secretBox.seal('s3cret', 'connector-1');
    expect(await again.ring.secretBox.open(sealed, 'connector-1')).toBe('s3cret');
  });

  test('reads keys from variables and files, and says a file outside the data directory is configured', async () => {
    const file = join(outside.path, 'secret.key');
    writeFileSync(file, `${randomKey()}\n`, { mode: 0o600 });
    const { ring, lines } = await load(
      inputs({ secret: { file }, session: { value: randomKey() }, pepper: { value: randomKey() } }),
    );
    expect(ring.secretKeyOrigin).toBe('configured');
    expect(ring.sessionHashes).toBeDefined();
    expect(ring.pepper?.length).toBe(32);
    expect(lines).toEqual([]);
    expect(() => statSync(join(dataDir.path, 'secret.key'))).toThrow();
  });

  test('counts a key file inside the data directory as kept with the data', async () => {
    const file = join(dataDir.path, 'mine.key');
    writeFileSync(file, randomKey(), { mode: 0o600 });
    expect((await load(inputs({ secret: { file } }))).ring.secretKeyOrigin).toBe('data-dir');
  });

  test('warns about a key file others can read', async () => {
    const file = join(outside.path, 'session.key');
    writeFileSync(file, randomKey());
    chmodSync(file, 0o644);
    const { lines } = await load(inputs({ session: { file } }));
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', path: file }));
  });

  test('refuses a key that is short, not base64, or too regular to be random', async () => {
    const cases: [string, RegExp][] = [
      [Buffer.alloc(16, 7).toString('base64'), /must be 32 bytes/],
      ['not base64 at all, clearly', /must be 32 bytes/],
      [Buffer.alloc(32, 7).toString('base64'), /too regular/],
      [Buffer.from('dev-encryption-key-32-chars-long').toString('base64'), /too regular/],
    ];
    for (const [value, message] of cases) {
      await expect(load(inputs({ session: { value } }))).rejects.toThrow(message);
    }
  });

  test('refuses a key set twice, a missing file, and two roles sharing a key', async () => {
    const value = randomKey();
    await expect(load(inputs({ session: { value, file: '/x' } }))).rejects.toThrow(
      'QUERENT_SESSION_KEY and QUERENT_SESSION_KEY_FILE are both set.',
    );
    await expect(load(inputs({ pepper: { file: join(outside.path, 'none') } }))).rejects.toThrow(
      'Cannot read QUERENT_PASSWORD_PEPPER_FILE',
    );
    await expect(load(inputs({ session: { value }, pepper: { value } }))).rejects.toThrow(
      'QUERENT_PASSWORD_PEPPER equals QUERENT_SESSION_KEY.',
    );
  });

  test('never puts a key in a message', async () => {
    const value = Buffer.alloc(32, 7).toString('base64');
    const failure = await load(inputs({ session: { value } })).catch((error: Error) => error);
    expect(String(failure)).not.toContain(value);
  });
});
