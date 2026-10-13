import { describe, expect, test } from 'bun:test';
import { accessSentence, readOnlyOf, readOnlyUser, writeAccess } from './access.ts';
import type { ValkeySession } from './session.ts';

/** The rights of a fake ACL user. */
interface Rights {
  /** The commands it may run, in upper case. */
  readonly commands: readonly string[];
  /** The prefix of the keys it reaches, or none for every key. */
  readonly prefix?: string;
  /** The keys of the keyspace, as `SCAN` lists them. */
  readonly keys?: readonly string[];
  /** Whether it may not run `ACL DRYRUN`. */
  readonly mayNotAsk?: boolean;
}

/**
 * What `ACL DRYRUN` answers for a command, as Valkey words it.
 *
 * @param rights - The user's rights.
 * @param command - The command.
 * @param key - The key or channel it names, if any.
 * @returns `OK`, or the refusal of the command, or of the key.
 */
function dryRun(rights: Rights, command: string, key: string | undefined): string {
  if (!rights.commands.includes(command))
    return `User app has no permissions to run the '${command.toLowerCase()}' command`;
  const keyed = !['FLUSHALL', 'EVAL', 'CONFIG'].includes(command);
  if (keyed && key !== undefined && !key.startsWith(rights.prefix ?? ''))
    return `User app has no permissions to access the '${key}' key`;
  return 'OK';
}

/**
 * A session over a fake ACL user, which records every command sent.
 *
 * @param rights - The user's rights.
 * @returns The session and what was sent.
 */
function sessionOf(rights: Rights): { session: ValkeySession; sent: string[][] } {
  const sent: string[][] = [];
  const session: ValkeySession = {
    send: (command, args) => {
      sent.push([command, ...args]);
      if (command === 'SCAN') return Promise.resolve(['0', [...(rights.keys ?? [])]]);
      if (rights.mayNotAsk) return Promise.reject(new Error('NOPERM'));
      return Promise.resolve(dryRun(rights, args[2] ?? '', args[3]));
    },
    close: () => undefined,
  };
  return { session, sent };
}

const signal = AbortSignal.timeout(1000);

/**
 * What the test says of a fake user.
 *
 * @param rights - The user's rights.
 * @returns The commands allowed, whether a doubt is left, and the verdict.
 */
async function verdictOf(rights: Rights) {
  const access = await writeAccess(sessionOf(rights).session, 'app', signal);
  return { allowed: access?.allowed, readOnly: readOnlyOf(access) };
}

describe('what a Valkey user may do', () => {
  test('is asked with dry runs and a scan only, so nothing is written to find out', async () => {
    const { session, sent } = sessionOf({ commands: ['GET'], keys: ['service:api'] });
    expect(readOnlyOf(await writeAccess(session, 'app', signal))).toBe(true);
    const [scan, ...dryRuns] = sent;
    expect(scan?.[0]).toBe('SCAN');
    expect(dryRuns.length).toBeGreaterThan(5);
    for (const command of dryRuns) expect(command.slice(0, 3)).toEqual(['ACL', 'DRYRUN', 'app']);
  });

  test('names the write commands the user may run', async () => {
    const commands = ['GET', 'SET', 'DEL', 'FLUSHALL', 'EVAL', 'CONFIG'];
    expect(await verdictOf({ commands, keys: ['k'] })).toEqual({
      allowed: ['SET', 'DEL', 'FLUSHALL', 'EVAL', 'CONFIG SET'],
      readOnly: false,
    });
  });

  test('a user with one write command of any data type can write', async () => {
    for (const command of ['HSET', 'LPUSH', 'SADD', 'ZADD', 'XADD', 'EXPIRE', 'PUBLISH']) {
      const verdict = await verdictOf({ commands: ['GET', command], keys: ['k'] });
      expect(verdict, command).toEqual({ allowed: [command], readOnly: false });
    }
  });

  test('a user that writes the keys of a prefix can write, whatever key comes first', async () => {
    const commands = ['GET', 'SET', 'DEL'];
    const keys = ['other:1', 'app:1'];
    expect(await verdictOf({ commands, prefix: 'app:', keys })).toEqual({
      allowed: ['SET', 'DEL'],
      readOnly: false,
    });
  });

  test('a refusal of the key alone is unknown, never read-only', async () => {
    const commands = ['GET', 'SET', 'DEL'];
    const none = await verdictOf({ commands, prefix: 'app:', keys: [] });
    expect(none).toEqual({ allowed: [], readOnly: null });
    const elsewhere = await verdictOf({ commands, prefix: 'app:', keys: ['other:1'] });
    expect(elsewhere).toEqual({ allowed: [], readOnly: null });
  });

  test('a user refused every command is read-only, with or without a key to try', async () => {
    expect(await verdictOf({ commands: ['GET'], keys: [] })).toEqual({
      allowed: [],
      readOnly: true,
    });
  });

  test('a user that may not ask is unknown, never read-only', async () => {
    const access = await writeAccess(
      sessionOf({ commands: [], mayNotAsk: true }).session,
      'a',
      signal,
    );
    expect(access).toBeNull();
    expect(readOnlyOf(access)).toBeNull();
  });

  test('each verdict has its sentence', () => {
    expect(accessSentence('app', null)).toContain('may not run ACL DRYRUN');
    expect(accessSentence('app', { allowed: [], unsure: true })).toContain('unknown');
    expect(accessSentence('app', { allowed: [], unsure: false })).toBe('User app cannot write.');
    expect(accessSentence('app', { allowed: ['SET'], unsure: false })).toContain('can write');
  });

  test('the user to create gets the read commands only', () => {
    expect(readOnlyUser).toContain('+@read');
    expect(readOnlyUser).not.toMatch(/\+@(all|write)|allcommands/);
  });
});
