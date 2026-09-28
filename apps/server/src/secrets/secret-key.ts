/** Loads the key that encrypts credentials: from the environment, or a file in the data directory. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../lib/logger.ts';

/** The key file created in the data directory when no key is configured. */
const keyFileName = 'secret.key';

/** The key length, in bytes. */
const keyLength = 32;

/** Where the key comes from. */
interface KeySource {
  /** The `QUERENT_SECRET_KEY` value: 32 bytes in base64. */
  readonly configuredKey: string | undefined;
  /** The data directory, where a generated key is kept. */
  readonly dataDir: string;
  /** Receives the warning when a key is generated. */
  readonly logger: Logger;
}

/**
 * Decodes and checks a base64 key.
 *
 * @param base64 - The key in base64.
 * @param origin - Where it came from, for the error message.
 * @returns The raw key bytes.
 * @throws {Error} When the key is not 32 bytes of base64.
 */
function decodeKey(base64: string, origin: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Buffer.from(base64.trim(), 'base64'));
  if (bytes.length !== keyLength) {
    throw new Error(
      `${origin} must be ${keyLength} bytes in base64 (for example \`openssl rand -base64 32\`).`,
    );
  }
  return bytes;
}

/**
 * Reads the key file, creating it with a random key and mode 0600 the first time.
 *
 * @param dataDir - The data directory.
 * @param logger - Receives the warning when the key is created.
 * @returns The raw key bytes.
 */
function readOrCreateKeyFile(dataDir: string, logger: Logger): Uint8Array<ArrayBuffer> {
  const path = join(dataDir, keyFileName);
  if (existsSync(path)) return decodeKey(readFileSync(path, 'utf8'), path);
  const key = crypto.getRandomValues(new Uint8Array(keyLength));
  writeFileSync(path, `${Buffer.from(key).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  logger.warn(
    'Generated a secret key in the data directory. Backups of the data directory contain it.',
    {
      path,
    },
  );
  return key;
}

/**
 * Loads the key that encrypts connector credentials: `QUERENT_SECRET_KEY` when set, otherwise the
 * key file in the data directory.
 *
 * @param source - The configured key, the data directory and the logger.
 * @returns An AES-GCM key that cannot be exported.
 * @throws {Error} When the configured key or the key file is not 32 bytes of base64.
 */
export async function loadSecretKey(source: KeySource): Promise<CryptoKey> {
  const raw =
    source.configuredKey === undefined
      ? readOrCreateKeyFile(source.dataDir, source.logger)
      : decodeKey(source.configuredKey, 'QUERENT_SECRET_KEY');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
