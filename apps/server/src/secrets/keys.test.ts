import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureLogs, temporaryDir } from '../test/fixtures.ts';
import { type KeyInput, type KeyInputs, loadKeys } from './keys.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let outside: ReturnType<typeof temporaryDir>;
let keysDir: string;

beforeEach(() => {
  dataDir = temporaryDir();
  outside = temporaryDir();
  keysDir = join(outside.path, 'keys');
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
  return { ring: await loadKeys({ keys, dataDir: dataDir.path, keysDir, logger }), lines };
}

/**
 * Every key given in a variable.
 *
 * @returns The inputs.
 */
function allGiven(): KeyInputs {
  return inputs({
    secret: { value: randomKey() },
    session: { value: randomKey() },
    pepper: { value: randomKey() },
  });
}

describe('loading the keys', () => {
  test('generates each key not given, mode 0600, in a keys directory only its owner reads', async () => {
    const { ring, lines } = await load(inputs());
    expect(statSync(keysDir).mode & 0o777).toBe(0o700);
    for (const file of ['secret.key', 'session.key', 'password-pepper.key']) {
      const path = join(keysDir, file);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(Buffer.from(readFileSync(path, 'utf8').trim(), 'base64').length).toBe(32);
      expect(lines).toContainEqual(expect.objectContaining({ level: 'info', path }));
    }
    expect(ring.secretKeyInDataDir).toBe(false);
    expect(readdirSync(dataDir.path)).toEqual([]);
    const again = await load(inputs());
    const sealed = await ring.secretBox.seal('s3cret', 'connector-1');
    expect(await again.ring.secretBox.open(sealed, 'connector-1')).toBe('s3cret');
    expect(again.ring.peppers.current.id).toBe(ring.peppers.current.id);
  });

  test('uses a key given, key by key, and generates only the others', async () => {
    const session = randomKey();
    const { ring } = await load(inputs({ session: { value: session } }));
    expect(readdirSync(keysDir).sort()).toEqual(['password-pepper.key', 'secret.key']);
    expect(ring.sessionHashes).toBeDefined();
    const { lines } = await load(allGiven());
    expect(lines).toEqual([]);
  });

  test('generates nothing, and makes no directory, when every key is given', async () => {
    await load(allGiven());
    expect(existsSync(keysDir)).toBe(false);
  });

  test('moves a secret key an earlier version left in the data directory', async () => {
    const old = randomKey();
    writeFileSync(join(dataDir.path, 'secret.key'), `${old}\n`, { mode: 0o600 });
    const { lines } = await load(inputs());
    expect(existsSync(join(dataDir.path, 'secret.key'))).toBe(false);
    expect(readFileSync(join(keysDir, 'secret.key'), 'utf8').trim()).toBe(old);
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn' }));
    writeFileSync(join(dataDir.path, 'secret.key'), randomKey(), { mode: 0o600 });
    await expect(load(inputs())).rejects.toThrow('hold different secret keys');
  });

  test('refuses a keys directory inside the data directory', async () => {
    keysDir = join(dataDir.path, 'keys');
    await expect(load(inputs())).rejects.toThrow('QUERENT_KEYS_DIR');
    keysDir = dataDir.path;
    await expect(load(inputs())).rejects.toThrow('QUERENT_KEYS_DIR');
  });

  test('reads keys from variables and files, and notes a file inside the data directory', async () => {
    const file = join(outside.path, 'secret.key');
    writeFileSync(file, `${randomKey()}\n`, { mode: 0o600 });
    const given = { session: { value: randomKey() }, pepper: { value: randomKey() } };
    const { ring, lines } = await load(inputs({ secret: { file }, ...given }));
    expect(ring.secretKeyInDataDir).toBe(false);
    expect(ring.peppers.current.id).toHaveLength(8);
    expect(lines).toEqual([]);
    const inside = join(dataDir.path, 'mine.key');
    writeFileSync(inside, randomKey(), { mode: 0o600 });
    const kept = await load(inputs({ secret: { file: inside }, ...given }));
    expect(kept.ring.secretKeyInDataDir).toBe(true);
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
