/**
 * The keys: read from a variable or a file, checked, and handed to what uses them. A key is 32
 * random bytes in base64 (`openssl rand -base64 32`). A key not given is generated in the keys
 * directory. No message ever contains a key.
 */
import type { Logger } from '../lib/logger.ts';
import {
  decodeKey,
  type GeneratedRole,
  generatedKeyPath,
  generatedKeys,
  isWithin,
  type Key,
  readKeyText,
} from './key-files.ts';
import { type KeyedHash, keyedHash } from './keyed-hash.ts';
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

/** The keys quanthea reads. Each is 32 random bytes in base64. */
export interface KeyInputs {
  /** Encrypts secrets at rest. */
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

/** Where a key comes from: a variable, a file a variable names, or a file quanthea generated. */
export type KeyOrigin =
  | { readonly kind: 'variable'; readonly variable: string }
  | { readonly kind: 'file'; readonly variable: string; readonly path: string }
  | { readonly kind: 'generated'; readonly path: string };

/** The keys, read and checked. */
export interface KeyRing {
  /** Where each key in use comes from, by field; a rotated-out key only when given. */
  readonly origins: Readonly<Partial<Record<keyof KeyInputs, KeyOrigin>>>;
  /** Seals secrets at rest with the secret key, and opens what the previous one sealed. */
  readonly secretBox: SecretBox;
  /** Indexes emails, under a key derived from the secret key. */
  readonly emailIndex: KeyedHash;
  /** Hashes what the configuration file declares, under a key derived from the secret key. */
  readonly fingerprints: KeyedHash;
  /** The session key's derived hashes. */
  readonly sessionHashes: SessionHashes;
  /** The peppers mixed into password hashes. */
  readonly peppers: Peppers;
}

/** A pepper: the keyed hash a password goes through before argon2id, and its id. */
export interface Pepper {
  /** A short id, stored with each password hash to say which pepper made it. */
  readonly id: string;
  /** The keyed hash. */
  readonly hash: KeyedHash;
}

/** The current pepper, and the one being rotated out. */
export interface Peppers {
  /** The pepper new hashes use. */
  readonly current: Pepper;
  /** The pepper being rotated out; its hashes still verify, and are made again. */
  readonly previous: Pepper | undefined;
}

/** The keyed hashes derived from the session key. */
export interface SessionHashes {
  /** Signs the session cookie. */
  readonly signature: KeyedHash;
  /** Hashes session ids for storage. */
  readonly idHash: KeyedHash;
  /** Hashes one-time tokens (invite and reset links) for storage. */
  readonly tokenHash: KeyedHash;
}

/** Where the keys come from. */
export interface KeySources {
  /** The key inputs from the environment. */
  readonly keys: KeyInputs;
  /** The data directory, which must hold no key. */
  readonly dataDir: string;
  /** Where keys not given are generated, outside the data directory. */
  readonly keysDir: string;
  /** Receives warnings. */
  readonly logger: Logger;
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
 * Reads a key file named by a variable.
 *
 * @param path - The file.
 * @param name - The variable that named it.
 * @param logger - Receives warnings.
 * @returns The file's text.
 * @throws {Error} When the file cannot be read.
 */
function readKeyFile(path: string, name: string, logger: Logger): string {
  try {
    return readKeyText(path, logger);
  } catch {
    throw new Error(`Cannot read ${name}_FILE (${path}).`);
  }
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
 * The keyed hashes of the session key, each for one purpose.
 *
 * @param session - The session key.
 * @returns The hashes.
 */
async function sessionHashesOf(session: Key): Promise<SessionHashes> {
  return {
    signature: await keyedHash(session, 'quanthea/session-signature/v1'),
    idHash: await keyedHash(session, 'quanthea/session-id/v1'),
    tokenHash: await keyedHash(session, 'quanthea/one-time-token/v1'),
  };
}

/**
 * A pepper from its key.
 *
 * @param key - The pepper key.
 * @returns The pepper.
 */
async function pepperOf(key: Key): Promise<Pepper> {
  const hash = await keyedHash(key, 'quanthea/password-pepper/v1');
  const id = Buffer.from(await hash.hash('quanthea/pepper-id'))
    .toString('hex')
    .slice(0, 8);
  return { id, hash };
}

/**
 * The peppers from their keys.
 *
 * @param current - The current pepper key.
 * @param previous - The pepper key being rotated out, if any.
 * @returns The peppers.
 */
async function peppersOf(current: Key, previous: Key | undefined): Promise<Peppers> {
  return { current: await pepperOf(current), previous: previous && (await pepperOf(previous)) };
}

/** The keys that are generated when not given. */
const generatedRoles: readonly GeneratedRole[] = ['secret', 'session', 'pepper'];

/**
 * Reads every key given, and generates the missing ones.
 *
 * @param sources - The key inputs, the directories and the logger.
 * @returns The keys by field, the rotated-out ones only when given.
 * @throws {Error} When a key is invalid, set twice, or shared by two roles.
 */
function readAll(sources: KeySources) {
  const { keys, logger } = sources;
  const given = Object.fromEntries(
    Object.entries(keys).map(([field, input]) => [field, readKey(input, logger)]),
  ) as Record<keyof KeyInputs, Key | undefined>;
  const missing = generatedRoles.filter((role) => given[role] === undefined);
  const read = { ...given, ...generatedKeys(missing, sources, logger) };
  refuseSharedKeys(
    Object.entries(keys).map(([field, input]) => [input.name, read[field as keyof KeyInputs]]),
  );
  return read as Record<GeneratedRole, Key> & Record<keyof KeyInputs, Key | undefined>;
}

/**
 * Where each key in use comes from.
 *
 * @param sources - The key inputs and the keys directory.
 * @returns The origins by field.
 */
function originsOf(sources: KeySources): Partial<Record<keyof KeyInputs, KeyOrigin>> {
  const origins: Partial<Record<keyof KeyInputs, KeyOrigin>> = {};
  for (const [field, input] of Object.entries(sources.keys) as [keyof KeyInputs, KeyInput][]) {
    if (input.value !== undefined) origins[field] = { kind: 'variable', variable: input.name };
    else if (input.file !== undefined)
      origins[field] = { kind: 'file', variable: `${input.name}_FILE`, path: input.file };
    else if ((generatedRoles as readonly string[]).includes(field))
      origins[field] = {
        kind: 'generated',
        path: generatedKeyPath(sources.keysDir, field as GeneratedRole),
      };
  }
  return origins;
}

/**
 * Refuses a key file of any role inside the data directory: a copy of the data must never carry a
 * key.
 *
 * @param sources - The key inputs and the data directory.
 * @throws {Error} When a key file is inside the data directory.
 */
function refuseKeyFilesInData(sources: KeySources): void {
  for (const input of Object.values(sources.keys) as KeyInput[]) {
    if (input.file === undefined || !isWithin(input.file, sources.dataDir)) continue;
    throw new Error(
      `${input.name}_FILE points into the data directory, and a copy of the data would carry it. Move the file out.`,
    );
  }
}

/**
 * Reads and checks every key, generates the missing ones, and opens the secret box.
 *
 * @param sources - The key inputs, the directories and the logger.
 * @returns The keys.
 * @throws {Error} When a key is invalid, set twice, shared by two roles, or kept in the data
 *   directory.
 */
export async function loadKeys(sources: KeySources): Promise<KeyRing> {
  refuseKeyFilesInData(sources);
  const read = readAll(sources);
  return {
    origins: originsOf(sources),
    secretBox: await openSecretBox(read.secret, read.secretPrevious),
    emailIndex: await keyedHash(read.secret, 'quanthea/email-index/v1'),
    fingerprints: await keyedHash(read.secret, 'quanthea/provisioning/v1'),
    sessionHashes: await sessionHashesOf(read.session),
    peppers: await peppersOf(read.pepper, read.pepperPrevious),
  };
}
