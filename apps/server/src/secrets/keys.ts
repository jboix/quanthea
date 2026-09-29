/**
 * The keys: read from a variable or a file, checked, and handed to what uses them. A key is 32
 * random bytes in base64 (`openssl rand -base64 32`). No message ever contains a key.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Logger } from '../lib/logger.ts';
import { openSecretBox, type SecretBox } from './secret-box.ts';

/** A key given in a variable, or in a file named by the variable with `_FILE` appended. */
export interface KeyInput {
  /** The variable's name, for messages. Never the value. */
  readonly name: string;
  /** The key in base64, from the variable. */
  readonly value: string | undefined;
  /** The path of a file holding the key in base64. */
  readonly file: string | undefined;
}

/** The keys querent reads. Each is 32 random bytes in base64. */
export interface KeyInputs {
  /** Encrypts secrets at rest. Unset in `none` mode means a key file in the data directory. */
  readonly secret: KeyInput;
  /** The key being rotated out: values it sealed still open, and are sealed again at startup. */
  readonly secretPrevious: KeyInput;
  /** Signs session cookies and keys the hashes of session ids and one-time tokens. */
  readonly session: KeyInput;
  /** Mixed into every password hash; it never reaches the database. */
  readonly pepper: KeyInput;
  /** The pepper being rotated out: passwords hashed with it still verify, and are rehashed. */
  readonly pepperPrevious: KeyInput;
}

/** The file a generated secret key is kept in, inside the data directory. */
const keyFileName = 'secret.key';

/** Bytes of a key. */
const keyLength = 32;

/** The fewest distinct byte values a random 32-byte key shows; far fewer means a made-up key. */
const minimumDistinctBytes = 16;

/** Standard or URL-safe base64. */
const base64Pattern = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** A 32-byte key. */
type Key = Uint8Array<ArrayBuffer>;

/** The keys, read and checked. */
export interface KeyRing {
  /** Seals secrets at rest with the secret key, and opens what the previous one sealed. */
  readonly secretBox: SecretBox;
  /** Whether the secret key was given, or sits in the data directory, where a copy of it goes. */
  readonly secretKeyOrigin: 'configured' | 'data-dir';
  /** Signs session cookies and keys the hashes of session ids and one-time tokens. */
  readonly session: Key | undefined;
  /** Mixed into every password hash. */
  readonly pepper: Key | undefined;
  /** The pepper being rotated out. */
  readonly pepperPrevious: Key | undefined;
}

/** Where the keys come from. */
export interface KeySources {
  /** The key inputs from the environment. */
  readonly keys: KeyInputs;
  /** The data directory, where a generated secret key is kept in `none` mode. */
  readonly dataDir: string;
  /** Receives warnings. */
  readonly logger: Logger;
}

/**
 * Decodes and checks a key.
 *
 * @param text - The key in base64.
 * @param name - Where it came from, for messages.
 * @returns The key.
 * @throws {Error} When it is not 32 bytes of base64, or too regular to be random.
 */
function decodeKey(text: string, name: string): Key {
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
 * @param name - The variable that named it.
 * @param logger - Receives the warning.
 * @returns The file's text.
 * @throws {Error} When the file cannot be read.
 */
function readKeyFile(path: string, name: string, logger: Logger): string {
  try {
    const text = readFileSync(path, 'utf8');
    if ((statSync(path).mode & 0o077) !== 0) {
      logger.warn('A key file can be read by others than its owner. Use mode 0600.', { path });
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.includes('must be')) throw error;
    throw new Error(`Cannot read ${name}_FILE (${path}).`);
  }
}

/**
 * Reads a key from its variable or its file.
 *
 * @param input - The variable and the file.
 * @param logger - Receives warnings.
 * @returns The key, or `undefined` when neither is set.
 * @throws {Error} When both are set, the file cannot be read, or the key is not valid.
 */
function readKey(input: KeyInput, logger: Logger): Key | undefined {
  if (input.value !== undefined && input.file !== undefined) {
    throw new Error(`${input.name} and ${input.name}_FILE are both set. Keep one.`);
  }
  if (input.value !== undefined) return decodeKey(input.value, input.name);
  if (input.file !== undefined)
    return decodeKey(readKeyFile(input.file, input.name, logger), input.name);
  return undefined;
}

/**
 * Reads the generated secret key from the data directory, creating it with mode 0600 first.
 *
 * @param dataDir - The data directory.
 * @param logger - Receives the warning when a key is generated.
 * @returns The key.
 */
function readOrCreateKeyFile(dataDir: string, logger: Logger): Key {
  const path = join(dataDir, keyFileName);
  if (existsSync(path)) return decodeKey(readFileSync(path, 'utf8'), path);
  const key = crypto.getRandomValues(new Uint8Array(keyLength));
  writeFileSync(path, `${Buffer.from(key).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  logger.warn(
    'Generated a secret key in the data directory. Backups of the data directory contain it.',
    { path },
  );
  return key;
}

/**
 * Whether a path lies inside a directory.
 *
 * @param path - The path.
 * @param directory - The directory.
 * @returns Whether it does.
 */
function isInside(path: string, directory: string): boolean {
  const between = relative(directory, path);
  return between !== '' && !between.startsWith('..') && !between.startsWith('/');
}

/**
 * Refuses two roles sharing a key: a leak of one would then open the other's secrets.
 *
 * @param keys - The keys read, by variable name.
 * @throws {Error} When two are equal.
 */
function refuseSharedKeys(keys: readonly [string, Key | undefined][]): void {
  const seen = new Map<string, string>();
  for (const [name, key] of keys) {
    if (key === undefined) continue;
    const text = Buffer.from(key).toString('base64');
    const other = seen.get(text);
    if (other) throw new Error(`${name} equals ${other}. Each key needs its own random value.`);
    seen.set(text, name);
  }
}

/**
 * Reads and checks every key, and opens the secret box.
 *
 * @param sources - The key inputs, the data directory and the logger.
 * @returns The keys.
 * @throws {Error} When a key is invalid, set twice, or shared by two roles.
 */
export async function loadKeys(sources: KeySources): Promise<KeyRing> {
  const { keys, logger } = sources;
  const read = Object.fromEntries(
    Object.entries(keys).map(([field, input]) => [field, readKey(input, logger)]),
  ) as Record<keyof KeyInputs, Key | undefined>;
  refuseSharedKeys(
    Object.entries(keys).map(([field, input]) => [input.name, read[field as keyof KeyInputs]]),
  );
  const secret = read.secret ?? readOrCreateKeyFile(sources.dataDir, logger);
  const inDataDir =
    read.secret === undefined ||
    (keys.secret.file !== undefined && isInside(keys.secret.file, sources.dataDir));
  return {
    secretBox: await openSecretBox(secret, read.secretPrevious),
    secretKeyOrigin: inDataDir ? 'data-dir' : 'configured',
    session: read.session,
    pepper: read.pepper,
    pepperPrevious: read.pepperPrevious,
  };
}
