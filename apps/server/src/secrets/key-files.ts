/**
 * Keys in files: their format, and the files querent generates for keys it is not given, one per
 * role, in the keys directory. That directory lies outside the data directory, so a copy of the
 * data never carries a key.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Logger } from '../lib/logger.ts';

/** A 32-byte key. */
export type Key = Uint8Array<ArrayBuffer>;

/** Bytes of a key. */
const keyLength = 32;

/** The fewest distinct byte values a random 32-byte key shows; far fewer means a made-up key. */
const minimumDistinctBytes = 16;

/** Standard or URL-safe base64. */
const base64Pattern = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** The file each generated key is kept in, by role. */
const keyFileNames = {
  secret: 'secret.key',
  session: 'session.key',
  pepper: 'password-pepper.key',
} as const;

/** A key querent generates when it is not given. */
export type GeneratedRole = keyof typeof keyFileNames;

/**
 * Decodes and checks a key.
 *
 * @param text - The key in base64.
 * @param name - Where it came from, for messages.
 * @returns The key.
 * @throws {Error} When it is not 32 bytes of base64, or too regular to be random.
 */
export function decodeKey(text: string, name: string): Key {
  const trimmed = text.trim();
  const bytes = new Uint8Array(Buffer.from(trimmed, 'base64'));
  if (!base64Pattern.test(trimmed) || bytes.length !== keyLength) {
    throw new Error(
      `${name} must be ${keyLength} bytes in base64 (for example \`openssl rand -base64 32\`).`,
    );
  }
  // Random bytes are almost never all printable: a key that is text is a passphrase in disguise.
  const isText = bytes.every((byte) => byte >= 0x20 && byte <= 0x7e);
  if (new Set(bytes).size < minimumDistinctBytes || isText) {
    throw new Error(
      `${name} is too regular to be random. Generate it with \`openssl rand -base64 32\`.`,
    );
  }
  return bytes;
}

/**
 * Reads a key file, and warns when others than its owner may read it.
 *
 * @param path - The file.
 * @param logger - Receives the warning.
 * @returns The file's text.
 * @throws {Error} When the file cannot be read.
 */
export function readKeyText(path: string, logger: Logger): string {
  const text = readFileSync(path, 'utf8');
  if ((statSync(path).mode & 0o077) !== 0) {
    logger.warn('A key file can be read by others than its owner. Use mode 0600.', { path });
  }
  return text;
}

/**
 * Whether a path is a directory or lies inside it.
 *
 * @param path - The path.
 * @param directory - The directory.
 * @returns Whether it does.
 */
export function isWithin(path: string, directory: string): boolean {
  const between = relative(directory, path);
  return !between.startsWith('..') && !between.startsWith('/');
}

/**
 * Creates the keys directory, readable by its owner only.
 *
 * @param keysDir - The keys directory.
 * @param dataDir - The data directory, which must not hold it.
 * @throws {Error} When the keys directory is the data directory or lies inside it.
 */
function prepareKeysDir(keysDir: string, dataDir: string): void {
  if (isWithin(keysDir, dataDir))
    throw new Error(
      `QUANTHEA_KEYS_DIR (${keysDir}) is inside the data directory. Keep the keys apart, so a copy of the data never carries them.`,
    );
  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
}

/**
 * The file a generated key is kept in.
 *
 * @param keysDir - The keys directory.
 * @param role - Which key.
 * @returns The path.
 */
export function generatedKeyPath(keysDir: string, role: GeneratedRole): string {
  return join(keysDir, keyFileNames[role]);
}

/**
 * Reads a generated key, generating it with mode 0600 first when it does not exist.
 *
 * @param keysDir - The keys directory.
 * @param role - Which key.
 * @param logger - Receives the notice when a key is generated.
 * @returns The key.
 */
function readOrCreateKey(keysDir: string, role: GeneratedRole, logger: Logger): Key {
  const path = generatedKeyPath(keysDir, role);
  if (existsSync(path)) return decodeKey(readKeyText(path, logger), path);
  const key = crypto.getRandomValues(new Uint8Array(keyLength));
  writeFileSync(path, `${Buffer.from(key).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  logger.info('Generated a key. Back it up apart from the data directory.', { path });
  return key;
}

/**
 * The keys querent was not given, read from the keys directory or generated there.
 *
 * @param roles - The keys not given.
 * @param directories - The keys and data directories.
 * @param directories.keysDir - Where generated keys live.
 * @param directories.dataDir - The data directory, which must not hold the keys.
 * @param logger - Receives notices.
 * @returns The keys, by role.
 */
export function generatedKeys(
  roles: readonly GeneratedRole[],
  directories: { readonly keysDir: string; readonly dataDir: string },
  logger: Logger,
): Partial<Record<GeneratedRole, Key>> {
  if (roles.length === 0) return {};
  const { keysDir, dataDir } = directories;
  prepareKeysDir(keysDir, dataDir);
  return Object.fromEntries(roles.map((role) => [role, readOrCreateKey(keysDir, role, logger)]));
}
