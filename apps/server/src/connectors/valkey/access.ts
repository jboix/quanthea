/**
 * What a Valkey or Redis ACL user may do beyond reading, asked with `ACL DRYRUN`, which checks
 * the user's rights and runs nothing. A dry run is refused either for the command or for the key
 * it names. Only a refusal of the command says the user cannot run it: a refusal of the key says
 * nothing about the keys the user does reach, so the commands are tried on a key the user reads.
 */
import type { ValkeySession } from './session.ts';

/** The placeholder of a probe for the key it is tried on. */
const keyPlace = '{key}';

/** The key tried when the user reads none the test could find. It is never written. */
const fallbackKey = 'quanthea:probe';

/**
 * Commands that write, one per data type, with those that delete everything, publish, run a
 * script or change the server.
 */
const writeProbes: readonly (readonly string[])[] = [
  ['SET', keyPlace, '1'],
  ['DEL', keyPlace],
  ['EXPIRE', keyPlace, '60'],
  ['HSET', keyPlace, 'field', '1'],
  ['LPUSH', keyPlace, '1'],
  ['SADD', keyPlace, '1'],
  ['ZADD', keyPlace, '1', 'member'],
  ['XADD', keyPlace, '*', 'field', '1'],
  ['PUBLISH', fallbackKey, '1'],
  ['FLUSHALL'],
  ['EVAL', 'return 1', '0'],
  ['CONFIG', 'SET', 'maxmemory', '0'],
];

/** How many scanned keys are tried to find one the user reads. */
const keysTried = 20;

/** What the dry runs say about a user. */
export interface WriteAccess {
  /** The write commands the user may run. */
  readonly allowed: readonly string[];
  /**
   * Whether a command was refused for its key or channel only, on a key the user does not read:
   * the user may still run it on the keys it reaches.
   */
  readonly unsure: boolean;
}

/** The command that makes a user that only reads, for the admin to copy. */
export const readOnlyUser =
  'ACL SETUSER quanthea_read on >choose-a-password ~* +@read -@dangerous +info +acl|whoami +acl|dryrun';

/**
 * A key the user reads, to try the write commands on.
 *
 * @param session - The session.
 * @param user - The user.
 * @param signal - The caller's signal.
 * @returns One of the first keys of the keyspace the user may `GET`, or `undefined` for none.
 */
async function readableKey(
  session: ValkeySession,
  user: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const scanned = await session.send('SCAN', ['0', 'COUNT', '100'], signal).catch(() => []);
  const keys = Array.isArray(scanned) && Array.isArray(scanned[1]) ? scanned[1] : [];
  for (const key of keys.slice(0, keysTried).map(String)) {
    const answer = await session.send('ACL', ['DRYRUN', user, 'GET', key], signal);
    if (answer === 'OK') return key;
  }
  return undefined;
}

/**
 * What one dry run says.
 *
 * @param answer - The answer of `ACL DRYRUN`.
 * @param onReadKey - Whether the command named a key the user reads.
 * @returns `allowed`, `refused` when the command itself is, or when the key is and the user reads
 *   it, and `unsure` for a refusal of a key or channel that says nothing of the others.
 */
function verdictOf(answer: unknown, onReadKey: boolean): 'allowed' | 'refused' | 'unsure' {
  if (answer === 'OK') return 'allowed';
  if (/\bcommand\b/i.test(String(answer))) return 'refused';
  return onReadKey && /\bkey\b/i.test(String(answer)) ? 'refused' : 'unsure';
}

/**
 * The name a probe is reported under.
 *
 * @param probe - The command and its arguments.
 * @returns The command, with its subcommand for `CONFIG SET`.
 */
function nameOf(probe: readonly string[]): string {
  return probe[0] === 'CONFIG' ? 'CONFIG SET' : (probe[0] ?? '');
}

/**
 * Asks `ACL DRYRUN` which write commands the user may run.
 *
 * @param session - The session.
 * @param user - The user.
 * @param signal - The caller's signal.
 * @returns The commands allowed and whether any answer left a doubt, or `null` when the user may
 *   not ask.
 */
export async function writeAccess(
  session: ValkeySession,
  user: string,
  signal: AbortSignal,
): Promise<WriteAccess | null> {
  try {
    const key = await readableKey(session, user, signal);
    const allowed: string[] = [];
    let unsure = false;
    for (const probe of writeProbes) {
      const args = probe.map((part) => (part === keyPlace ? (key ?? fallbackKey) : part));
      const answer = await session.send('ACL', ['DRYRUN', user, ...args], signal);
      const verdict = verdictOf(answer, key !== undefined && probe.includes(keyPlace));
      if (verdict === 'allowed') allowed.push(nameOf(probe));
      unsure ||= verdict === 'unsure';
    }
    return { allowed, unsure };
  } catch {
    return null;
  }
}

/**
 * Whether the user only reads, as far as the dry runs can say.
 *
 * @param access - What the dry runs said, or `null` when the user may not ask.
 * @returns `false` when a write command is allowed, `true` when each was refused as a command or
 *   on a key the user reads, and `null` when that is unknown.
 */
export function readOnlyOf(access: WriteAccess | null): boolean | null {
  if (access === null) return null;
  if (access.allowed.length > 0) return false;
  return access.unsure ? null : true;
}

/**
 * The sentence about the user.
 *
 * @param user - The user.
 * @param access - What the dry runs said, or `null` when the user may not ask.
 * @returns The sentence.
 */
export function accessSentence(user: string, access: WriteAccess | null): string {
  if (access === null)
    return `User ${user} may not run ACL DRYRUN, so whether it can write is unknown.`;
  const readOnly = readOnlyOf(access);
  if (readOnly === null)
    return `User ${user} reaches some keys only, and the test found none of them to try a write on, so whether it can write is unknown.`;
  return readOnly
    ? `User ${user} cannot write.`
    : `User ${user} can write: use a user with +@read only.`;
}
