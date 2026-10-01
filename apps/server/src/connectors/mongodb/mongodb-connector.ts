/**
 * The MongoDB connector kind: one aggregation pipeline per query over one collection, with the
 * official driver. The connection test says whether the user could write.
 */
import type { Frame } from '@quanthea/shared';
import { BSON, type Db, type Document, type MongoClient } from 'mongodb';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  defineConnector,
  type ExecutionContext,
  type HealthReport,
  type MongodbQuery,
  mongodbRefusedKeys,
} from '../_shared/index.ts';
import { describeDatabase, sampleField } from './catalog.ts';
import { clientOf, toConnectorError } from './client.ts';
import { frameOf } from './frames.ts';
import { mongodbGuide } from './guide.ts';
import { mongodbIcon } from './icon.ts';

/** The configuration of a MongoDB connector. */
const configSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .meta({ title: 'Host', examples: ['mongo.internal'] }),
  port: z.int().min(1).max(65535).default(27017).meta({ title: 'Port' }),
  srv: z.boolean().default(false).meta({
    title: 'DNS seed list (mongodb+srv)',
    description: 'For MongoDB Atlas and other seed list hosts. The port is not used.',
  }),
  database: z
    .string()
    .trim()
    .min(1)
    .meta({ title: 'Database', examples: ['shop'] }),
  username: z
    .string()
    .trim()
    .optional()
    .meta({
      title: 'Username',
      description: 'A user with the read role only.',
      examples: ['dash_ro'],
    }),
  authSource: z.string().trim().optional().meta({
    title: 'Authentication database',
    description: 'Empty when it is the database above.',
  }),
  tls: z.enum(['verify-full', 'require', 'disable']).default('verify-full').meta({
    title: 'TLS',
    description: 'verify-full checks the certificate; require encrypts without checking it.',
  }),
});

/** The credentials of a MongoDB connector. */
const secretSchema = z.object({
  password: z.string().optional().meta({ title: 'Password' }),
});

/** How long health checks, schema reads and samples may take, in milliseconds. */
const metadataTimeoutMs = 30_000;

/** The actions that let a user change data. */
const writeActions = new Set([
  'insert',
  'update',
  'remove',
  'createCollection',
  'dropCollection',
  'dropDatabase',
]);

/** One privilege, as `connectionStatus` gives it. */
interface Privilege {
  /** What it applies to. */
  readonly resource?: { readonly db?: string; readonly anyResource?: boolean };
  /** What it allows. */
  readonly actions?: readonly string[];
}

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
 * The first key, anywhere in a pipeline, that the connector refuses.
 *
 * @param node - The pipeline or a part of it.
 * @returns The key, or `undefined`.
 */
function refusedKeyIn(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  for (const [key, value] of Object.entries(node)) {
    if (mongodbRefusedKeys.has(key)) return key;
    const nested = refusedKeyIn(value);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Runs a bound pipeline and reads one document more than the row limit.
 *
 * @param database - The database.
 * @param query - The collection and the pipeline.
 * @param context - The execution context.
 * @returns One frame.
 * @throws {ConnectorError} `rejected` for a stage that writes or runs JavaScript, and any failure.
 */
async function execute(
  database: Db,
  query: MongodbQuery,
  context: ExecutionContext,
): Promise<Frame[]> {
  const refused = refusedKeyIn(query.pipeline);
  if (refused)
    throw new ConnectorError('rejected', `This connector only reads; ${refused} is refused.`);
  if (context.signal.aborted)
    throw new ConnectorError('timeout', 'The query was cancelled before it started.');
  const started = performance.now();
  const pipeline = BSON.EJSON.deserialize(query.pipeline as unknown as Document) as Document[];
  const documents: Document[] = [];
  try {
    const cursor = database.collection(query.collection).aggregate(pipeline, {
      maxTimeMS: context.timeoutMs,
      signal: context.signal,
      batchSize: Math.min(context.maxRows + 1, 1000),
    });
    for await (const document of cursor) {
      documents.push(document);
      if (documents.length > context.maxRows) break;
    }
  } catch (error) {
    throw toConnectorError(error, context.signal);
  }
  return [frameOf(documents, context, performance.now() - started)];
}

/**
 * Whether privileges let a user change data in a database.
 *
 * @param privileges - The user's privileges.
 * @param database - The database.
 * @returns `true` when one allows a write there.
 */
function canWrite(privileges: readonly Privilege[], database: string): boolean {
  return privileges.some((privilege) => {
    const { resource } = privilege;
    const applies = resource?.anyResource || resource?.db === '' || resource?.db === database;
    return applies && (privilege.actions ?? []).some((action) => writeActions.has(action));
  });
}

/**
 * The sentence about the user.
 *
 * @param user - The user, if one signed in.
 * @param readOnly - Whether it cannot write.
 * @returns The sentence.
 */
function accessSentence(user: string | undefined, readOnly: boolean | null): string {
  if (user === undefined) return 'No user signed in, so whether it can write is unknown.';
  return readOnly
    ? `User ${user} cannot write.`
    : `User ${user} can write: use a user with the read role only.`;
}

/**
 * Checks the server and whether the user could write.
 *
 * @param database - The database.
 * @param signal - The caller's signal.
 * @returns The health report.
 */
async function test(database: Db, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const build = await database.command({ buildInfo: 1 }, { signal: bounded(signal) });
    const status = await database.command(
      { connectionStatus: 1, showPrivileges: true },
      { signal: bounded(signal) },
    );
    const user: string | undefined = status.authInfo?.authenticatedUsers?.[0]?.user;
    const privileges: Privilege[] = status.authInfo?.authenticatedUserPrivileges ?? [];
    const readOnly = user === undefined ? null : !canWrite(privileges, database.databaseName);
    const message = `MongoDB ${String(build.version)}. ${accessSentence(user, readOnly)}`;
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
 * Runs a catalog read, its failures as connector errors.
 *
 * @param work - The read, given the combined signal.
 * @param signal - The caller's signal.
 * @returns What the read returns.
 * @throws {ConnectorError} When it fails.
 */
async function metadata<T>(work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal) {
  const combined = bounded(signal);
  try {
    return await work(combined);
  } catch (error) {
    throw toConnectorError(error, combined);
  }
}

/**
 * The connection of a connector.
 *
 * @param client - The client.
 * @param database - Its database.
 * @returns The connection.
 */
function connectionOf(client: MongoClient, database: Db): ConnectorInstance {
  return {
    test: (signal) => test(database, signal),
    describe: (signal) => metadata((bound) => describeDatabase(database, bound), signal),
    sampleValues: (field, limit, signal) =>
      metadata((bound) => sampleField(database, field, limit, bound), signal),
    execute: (query, context) =>
      query.language === 'mongodb'
        ? execute(database, query, context)
        : Promise.reject(
            new ConnectorError('rejected', 'MongoDB connectors run aggregation pipelines only.'),
          ),
    close: () => client.close(),
  };
}

/**
 * Where a connector points, for display, without its password.
 *
 * @param config - The configuration.
 * @returns Such as `mongodb://dash_ro@mongo.internal:27017/shop`.
 */
function targetOf(config: z.infer<typeof configSchema>): string {
  const user = config.username ? `${config.username}@` : '';
  const host = config.srv ? config.host : `${config.host}:${config.port}`;
  return `${config.srv ? 'mongodb+srv' : 'mongodb'}://${user}${host}/${config.database}`;
}

/** The MongoDB connector kind. */
export const mongodbConnector = defineConnector({
  kind: 'mongodb',
  displayName: 'MongoDB',
  icon: mongodbIcon,
  aliases: ['mongo', 'document', 'nosql', 'atlas'],
  language: 'mongodb',
  queryGuide: mongodbGuide,
  configSchema,
  secretSchema,
  describeTarget: targetOf,
  open({ config, secret }): ConnectorInstance {
    const client = clientOf({ ...config, password: secret.password });
    return connectionOf(client, client.db(config.database));
  },
});
