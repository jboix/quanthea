/** The PostgreSQL connector kind: read-only transactions, a statement timeout, and a row limit. */

import type { Frame } from '@quanthea/shared';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  createFrameBuilder,
  defineConnector,
  type ExecutionContext,
  type FieldReference,
  type HealthReport,
  type SqlQuery,
} from '../_shared/index.ts';
import { type CatalogRow, catalogQuery, quoteIdentifier, toEntities } from './catalog.ts';
import { fieldTypeOf, frameValue } from './columns.ts';
import { toConnectorError } from './errors.ts';
import { postgresGuide } from './guide.ts';
import { postgresIcon } from './icon.ts';
import { extensionQuery, type TimescaleRow, timescaleQuery, withTimescale } from './timescale.ts';

/** The configuration of a PostgreSQL connector. */
const configSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .meta({
      title: 'Host',
      examples: ['orders-replica.internal'],
    }),
  port: z.int().min(1).max(65535).default(5432).meta({ title: 'Port' }),
  database: z
    .string()
    .trim()
    .min(1)
    .meta({ title: 'Database', examples: ['orders'] }),
  username: z
    .string()
    .trim()
    .min(1)
    .meta({
      title: 'Username',
      description: 'SELECT grants are enough. The connection test says whether it can write.',
      examples: ['dash_ro'],
    }),
  tls: z.enum(['verify-full', 'require', 'prefer', 'disable']).default('verify-full').meta({
    title: 'TLS',
    description: 'verify-full checks the certificate; require encrypts without checking it.',
  }),
});

/** The credentials of a PostgreSQL connector. */
const secretSchema = z.object({
  password: z.string().meta({ title: 'Password' }),
});

/** Checks the server and whether the role can write, without touching table data. */
const healthQuery = `
SELECT current_setting('server_version') AS version, current_user AS role,
  (r.rolsuper
    OR has_database_privilege(current_database(), 'CREATE')
    OR EXISTS (SELECT 1 FROM information_schema.table_privileges p
      WHERE p.grantee = current_user AND p.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
  ) AS can_write,
  (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') AS timescaledb
FROM pg_roles r WHERE r.rolname = current_user`;

/** The statement timeout of health checks, schema reads and samples, in milliseconds. */
const metadataTimeoutMs = 30_000;

/** A query the driver can cancel on the server. */
interface CancellableQuery<T> extends PromiseLike<T> {
  /**
   * Sends a cancel request for the running query.
   *
   * @returns The query.
   */
  cancel(): unknown;
}

/** Rows as arrays, with the driver's description of each column. */
interface DescribedRows {
  /** One array of values per row. */
  readonly [row: number]: readonly unknown[];
  /** The number of rows. */
  readonly length: number;
  /** The column names and type OIDs, known even when there are no rows. */
  readonly columns: readonly { readonly name: string; readonly type: number }[];
}

/**
 * Runs work in a read-only transaction with a statement timeout, so the server refuses writes and
 * stops long statements whatever the query says.
 *
 * @param sql - The connection pool.
 * @param timeoutMs - The statement timeout.
 * @param work - The queries to run in the transaction.
 * @returns What `work` returns.
 */
function readOnly<T>(
  sql: Sql,
  timeoutMs: number,
  work: (transaction: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin('read only', async (transaction) => {
    await transaction.unsafe(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
    return work(transaction);
  }) as Promise<T>;
}

/**
 * Waits for a query, cancelling it on the server when the signal fires.
 *
 * @param query - The pending query.
 * @param signal - The caller's signal.
 * @returns The query result.
 * @throws {ConnectorError} `timeout` when the signal fired before the query started.
 */
async function cancellable<T>(query: CancellableQuery<T>, signal: AbortSignal): Promise<T> {
  // The driver runs a query when it is awaited, so an unawaited query never reaches the server.
  if (signal.aborted)
    throw new ConnectorError('timeout', 'The query was cancelled before it started.');
  const cancel = (): void => {
    query.cancel();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await query;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/**
 * Wraps a statement so the server returns one row more than the limit, which tells the frame
 * builder the result was truncated.
 *
 * @param text - A single SELECT or WITH statement.
 * @param maxRows - The row limit.
 * @returns The limited statement.
 */
function limitRows(text: string, maxRows: number): string {
  const statement = text.trim().replace(/;\s*$/, '');
  return `SELECT * FROM (\n${statement}\n) AS querent_rows LIMIT ${Math.trunc(maxRows) + 1}`;
}

/**
 * Turns a result into a frame, with fields typed from the row description.
 *
 * @param result - The rows as arrays, with the driver's column descriptions.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @returns The frame.
 */
function toFrame(result: DescribedRows, context: ExecutionContext, durationMs: number): Frame {
  const fields = result.columns.map((column) => ({
    name: column.name,
    type: fieldTypeOf(column.type),
  }));
  const builder = createFrameBuilder({ refId: context.refId, fields, maxRows: context.maxRows });
  for (let index = 0; index < result.length; index += 1) {
    const row = result[index] ?? [];
    if (!builder.add(fields.map((field, column) => frameValue(field.type, row[column])))) break;
  }
  return builder.build(durationMs);
}

/**
 * Runs a bound SQL query.
 *
 * @param sql - The connection pool.
 * @param query - The bound query.
 * @param context - The execution context.
 * @returns One frame.
 * @throws {ConnectorError} On any failure, with a message that quotes no data.
 */
async function execute(sql: Sql, query: SqlQuery, context: ExecutionContext): Promise<Frame[]> {
  const started = performance.now();
  const text = limitRows(query.text, context.maxRows);
  const parameters = [...query.parameters] as postgres.ParameterOrJSON<never>[];
  try {
    const result = await readOnly(sql, context.timeoutMs, (transaction) =>
      cancellable<DescribedRows>(transaction.unsafe(text, parameters).values(), context.signal),
    );
    return [toFrame(result, context, performance.now() - started)];
  } catch (error) {
    throw toConnectorError(error);
  }
}

/** The row of {@link healthQuery}. */
interface HealthRow {
  /** The server version. */
  readonly version: string;
  /** The role the connector uses. */
  readonly role: string;
  /** Whether the role can write anything. */
  readonly can_write: boolean;
  /** The TimescaleDB version, when the database has the extension. */
  readonly timescaledb: string | null;
}

/**
 * Checks the connection and whether the role can write.
 *
 * @param sql - The connection pool.
 * @param signal - The caller's signal.
 * @returns The health report.
 */
async function test(sql: Sql, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const rows = await readOnly(sql, metadataTimeoutMs, (transaction) =>
      cancellable<readonly HealthRow[]>(transaction.unsafe(healthQuery), signal),
    );
    const row = rows[0];
    const readOnlyRole = row?.can_write === false;
    const access = readOnlyRole ? 'has no write grants' : 'can write: use a read-only role';
    const timescale = row?.timescaledb ? ` with TimescaleDB ${row.timescaledb}` : '';
    const message = `PostgreSQL ${row?.version ?? '?'}${timescale}. Role ${row?.role ?? '?'} ${access}.`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly: readOnlyRole };
  } catch (error) {
    const message = toConnectorError(error).safeMessage;
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}

/**
 * Splits an entity name into schema and table.
 *
 * @param entity - `orders` or `analytics.events`.
 * @returns The schema and the table.
 */
function splitEntity(entity: string): [string, string] {
  const dot = entity.indexOf('.');
  return dot === -1 ? ['public', entity] : [entity.slice(0, dot), entity.slice(dot + 1)];
}

/**
 * Reads up to `limit + 1` distinct values of a column in a transaction, after checking the column
 * exists, so identifiers are never taken from the caller unchecked.
 *
 * @param transaction - The read-only transaction.
 * @param field - The entity and column.
 * @param limit - How many values the caller wants.
 * @param signal - The caller's signal.
 * @returns The values as rows.
 * @throws {ConnectorError} `not_found` when the column does not exist.
 */
async function readDistinct(
  transaction: TransactionSql,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
): Promise<DescribedRows> {
  const [schema, table] = splitEntity(field.entity);
  const found = await transaction.unsafe(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3',
    [schema, table, field.field],
  );
  if (found.length === 0) {
    throw new ConnectorError(
      'not_found',
      `Column "${field.entity}.${field.field}" does not exist.`,
    );
  }
  const column = quoteIdentifier(field.field);
  const source = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const text = `SELECT DISTINCT ${column}::text FROM ${source} WHERE ${column} IS NOT NULL LIMIT ${Math.trunc(limit) + 1}`;
  return cancellable<DescribedRows>(transaction.unsafe(text).values(), signal);
}

/**
 * Reads distinct values of a column.
 *
 * @param sql - The connection pool.
 * @param field - The entity and column.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values and whether there are more.
 * @throws {ConnectorError} `not_found` when the column does not exist.
 */
async function sampleValues(sql: Sql, field: FieldReference, limit: number, signal: AbortSignal) {
  try {
    const rows = await readOnly(sql, metadataTimeoutMs, (transaction) =>
      readDistinct(transaction, field, limit, signal),
    );
    const all = Array.from({ length: rows.length }, (_unused, index) => String(rows[index]?.[0]));
    return { values: all.slice(0, limit), complete: all.length <= limit };
  } catch (error) {
    throw toConnectorError(error);
  }
}

/**
 * Reads the schema from the catalog.
 *
 * @param sql - The connection pool.
 * @param signal - The caller's signal.
 * @returns The schema snapshot.
 */
async function describe(sql: Sql, signal: AbortSignal) {
  try {
    const [rows, timescale] = await readOnly(sql, metadataTimeoutMs, async (transaction) => {
      const catalog = await cancellable<readonly CatalogRow[]>(
        transaction.unsafe(catalogQuery),
        signal,
      );
      const extension = await transaction.unsafe(extensionQuery);
      if (extension.length === 0) return [catalog, []] as const;
      const extra = await cancellable<readonly TimescaleRow[]>(
        transaction.unsafe(timescaleQuery),
        signal,
      );
      return [catalog, extra] as const;
    });
    return { entities: withTimescale(toEntities(rows, fieldTypeOf), timescale) };
  } catch (error) {
    throw toConnectorError(error);
  }
}

/**
 * Opens a pool for a connector. It connects on the first query.
 *
 * @param config - The parsed configuration.
 * @param password - The password.
 * @returns The pool.
 */
function openPool(config: z.output<typeof configSchema>, password: string): Sql {
  return postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password,
    ssl: config.tls === 'disable' ? false : config.tls,
    max: 4,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: 'querent' },
  });
}

/** The PostgreSQL connector kind. */
export const postgresConnector = defineConnector({
  kind: 'postgres',
  displayName: 'PostgreSQL',
  aliases: ['timescaledb', 'timescale'],
  icon: postgresIcon,
  language: 'sql',
  dialect: 'postgres',
  queryGuide: postgresGuide,
  configSchema,
  secretSchema,
  describeTarget: (config) =>
    `postgres://${config.username}@${config.host}:${config.port}/${config.database}`,
  open({ config, secret }): ConnectorInstance {
    const sql = openPool(config, secret.password);
    return {
      test: (signal) => test(sql, signal),
      describe: (signal) => describe(sql, signal),
      sampleValues: (field, limit, signal) => sampleValues(sql, field, limit, signal),
      execute: (query, context) =>
        query.language === 'sql'
          ? execute(sql, query, context)
          : Promise.reject(
              new ConnectorError('rejected', 'PostgreSQL connectors run SQL queries only.'),
            ),
      close: () => sql.end({ timeout: 5 }),
    };
  },
});
