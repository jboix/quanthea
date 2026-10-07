/**
 * The Valkey connector kind, for Valkey and Redis: one read command per query, from the list the
 * kit holds, over Bun's built-in client. The connection test says whether the ACL user could write.
 */
import type { Frame } from '@quanthea/shared';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  defineConnector,
  type ExecutionContext,
  type FieldReference,
  type HealthReport,
  type RedisQuery,
  redisReadCommands,
} from '../_shared/index.ts';
import { describeKeys, scanKeys } from './catalog.ts';
import { frameOf } from './frames.ts';
import { valkeyGuide } from './guide.ts';
import { valkeyIcon } from './icon.ts';
import { openSession, toConnectorError, type ValkeySession } from './session.ts';

/** The configuration of a Valkey connector. */
const configSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .meta({ title: 'Host', examples: ['valkey.internal'] }),
  port: z.int().min(1).max(65535).default(6379).meta({ title: 'Port' }),
  database: z.int().min(0).max(1000).default(0).meta({ title: 'Database number' }),
  username: z
    .string()
    .trim()
    .optional()
    .meta({
      title: 'Username',
      description: 'An ACL user with +@read only. Empty for the default user.',
      examples: ['dash_ro'],
    }),
  tls: z.enum(['verify-full', 'require', 'disable']).default('disable').meta({
    title: 'TLS',
    description: 'verify-full checks the certificate; require encrypts without checking it.',
  }),
});

/** The credentials of a Valkey connector. */
const secretSchema = z.object({
  password: z.string().optional().meta({ title: 'Password' }),
});

/** How long health checks, schema reads and samples may take, in milliseconds. */
const metadataTimeoutMs = 30_000;

/** How many keys of a pattern a sample opens. */
const sampledKeys = 100;

/**
 * The caller's signal, also fired at the metadata timeout.
 *
 * @param signal - The caller's signal.
 * @returns The combined signal.
 */
function bounded(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)]);
}

/**
 * Runs a bound command.
 *
 * @param session - The session.
 * @param query - The command and its arguments.
 * @param context - The execution context.
 * @returns One frame.
 * @throws {ConnectorError} `rejected` for a command outside the read list, and any failure.
 */
async function execute(
  session: ValkeySession,
  query: RedisQuery,
  context: ExecutionContext,
): Promise<Frame[]> {
  if (!redisReadCommands.has(query.command))
    throw new ConnectorError('rejected', 'This connector runs read commands only.');
  const started = performance.now();
  const answer = await session.send(query.command, query.args, context.signal);
  return [frameOf(query, answer, context, performance.now() - started)];
}

/**
 * Whether the user could write, as `ACL DRYRUN` says.
 *
 * @param session - The session.
 * @param user - The user.
 * @param signal - The caller's signal.
 * @returns `true` when it cannot, `false` when it can, `null` when the user may not ask.
 */
async function readOnlyOf(
  session: ValkeySession,
  user: string,
  signal: AbortSignal,
): Promise<boolean | null> {
  try {
    const answer = await session.send(
      'ACL',
      ['DRYRUN', user, 'SET', 'quanthea:probe', '1'],
      signal,
    );
    return answer !== 'OK';
  } catch {
    return null;
  }
}

/**
 * The sentence about the user.
 *
 * @param user - The user.
 * @param readOnly - Whether it cannot write.
 * @returns The sentence.
 */
function accessSentence(user: string, readOnly: boolean | null): string {
  if (readOnly === null)
    return `User ${user} may not run ACL DRYRUN, so whether it can write is unknown.`;
  return readOnly
    ? `User ${user} cannot write.`
    : `User ${user} can write: use a user with +@read only.`;
}

/**
 * Checks the server and whether the user could write.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns The health report.
 */
async function test(session: ValkeySession, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const hello = (await session.send('HELLO', [], bounded(signal))) as {
      server?: string;
      version?: string;
    };
    const user = String(
      await session.send('ACL', ['WHOAMI'], bounded(signal)).catch(() => 'default'),
    );
    const readOnly = await readOnlyOf(session, user, bounded(signal));
    const server = hello.server === 'valkey' ? 'Valkey' : 'Redis';
    const message = `${server} ${hello.version ?? '?'}. ${accessSentence(user, readOnly)}`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly };
  } catch (error) {
    return {
      ok: false,
      latencyMs: latencyMs(),
      message: toConnectorError(error).safeMessage,
      readOnly: null,
    };
  }
}

/**
 * The values of a field of a key pattern: its keys, a hash field's values, or a sorted set's
 * members.
 *
 * @param session - The session.
 * @param field - The pattern and the field.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values, at most one more than the limit.
 * @throws {ConnectorError} `not_found` when the pattern has no such field.
 */
async function valuesOf(
  session: ValkeySession,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
) {
  const keys = await scanKeys(session, field.entity, signal);
  if (field.field === 'key') return keys;
  const [first] = keys;
  const type = first === undefined ? 'none' : String(await session.send('TYPE', [first], signal));
  if (type === 'hash') {
    const answers = await Promise.all(
      keys.slice(0, sampledKeys).map((key) => session.send('HGET', [key, field.field], signal)),
    );
    return [...new Set(answers.filter((value) => value !== null).map(String))];
  }
  if (type === 'zset' && field.field === 'member')
    return (await session.send('ZRANGE', [first ?? '', '0', String(limit)], signal)) as string[];
  throw new ConnectorError(
    'not_found',
    `"${field.entity}" has no field "${field.field}" to sample.`,
  );
}

/**
 * Reads distinct values of a field.
 *
 * @param session - The session.
 * @param field - The pattern and the field.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values and whether there are more.
 */
async function sampleValues(
  session: ValkeySession,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
) {
  const all = await valuesOf(session, field, limit, bounded(signal));
  return { values: all.slice(0, limit), complete: all.length <= limit };
}

/** The Valkey connector kind. */
export const valkeyConnector = defineConnector({
  kind: 'valkey',
  displayName: 'Valkey',
  icon: valkeyIcon,
  aliases: ['redis', 'key value', 'cache'],
  language: 'redis',
  queryGuide: valkeyGuide,
  configSchema,
  secretSchema,
  describeTarget: (config) => {
    const user = config.username ? `${config.username}@` : '';
    return `valkey://${user}${config.host}:${config.port}/${config.database}`;
  },
  open({ config, secret }): ConnectorInstance {
    const session = openSession({ ...config, password: secret.password });
    return {
      test: (signal) => test(session, signal),
      describe: (signal) => describeKeys(session, bounded(signal)),
      sampleValues: (field, limit, signal) => sampleValues(session, field, limit, signal),
      execute: (query, context) =>
        query.language === 'redis'
          ? execute(session, query, context)
          : Promise.reject(
              new ConnectorError('rejected', 'Valkey connectors run Redis commands only.'),
            ),
      close: () => {
        session.close();
        return Promise.resolve();
      },
    };
  },
});
