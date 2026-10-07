/**
 * What MySQL and MariaDB share: read-only sessions in UTC, prepared statements, a row limit the
 * server applies and the reader enforces, and `KILL QUERY` at the timeout. Each product is a kind
 * of its own, defined with {@link defineMysqlKind}.
 */
import type { Frame } from '@quanthea/shared';
import type { Pool } from 'mysql2';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorIcon,
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
import { mysqlGuide } from './guide.ts';
import { openPool, type StreamedRows, streamRows, withSession } from './session.ts';

/** A product the engine serves. */
type Product = 'MySQL' | 'MariaDB';

/** The configuration of a MySQL or MariaDB connector. */
const configSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .meta({
      title: 'Host',
      examples: ['orders-replica.internal'],
    }),
  port: z.int().min(1).max(65535).default(3306).meta({ title: 'Port' }),
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
  tls: z.enum(['verify-full', 'require', 'disable']).default('verify-full').meta({
    title: 'TLS',
    description: 'verify-full checks the certificate; require encrypts without checking it.',
  }),
});

/** The credentials of a MySQL or MariaDB connector. */
const secretSchema = z.object({
  password: z.string().meta({ title: 'Password' }),
});

/** Grants that let a user change data, the schema or the server. */
const writeGrants = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'INDEX',
  'CREATE VIEW',
  'CREATE ROUTINE',
  'ALTER ROUTINE',
  'TRIGGER',
  'EVENT',
  'FILE',
  'SUPER',
];

/** The write grants as quoted SQL strings, for an `IN` list. */
const writeGrantList = writeGrants.map((grant) => `'${grant}'`).join(', ');

/** Checks the server and counts the user's write grants, without touching table data. */
const healthQuery = `
SELECT VERSION() AS version, CURRENT_USER() AS user_name, (
  SELECT COUNT(*) FROM (
    SELECT GRANTEE, PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES
    UNION ALL SELECT GRANTEE, PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES
    UNION ALL SELECT GRANTEE, PRIVILEGE_TYPE FROM information_schema.TABLE_PRIVILEGES
  ) AS grants
  WHERE grants.GRANTEE = CONCAT('''', REPLACE(CURRENT_USER(), '@', '''@'''), '''')
    AND grants.PRIVILEGE_TYPE IN (${writeGrantList})
) AS write_grants`;

/** How long health checks, schema reads and samples may take, in milliseconds. */
const metadataTimeoutMs = 30_000;

/** The row cap of schema reads: one row per column. */
const catalogRowLimit = 100_000;

/**
 * The caller's signal, also fired at the metadata timeout.
 *
 * @param signal - The caller's signal.
 * @returns The combined signal.
 */
function metadataSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)]);
}

/**
 * Turns streamed rows into a frame, with fields typed from the result columns.
 *
 * @param result - The columns and rows.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @returns The frame.
 */
function toFrame(result: StreamedRows, context: ExecutionContext, durationMs: number): Frame {
  const fields = result.fields.map((column) => ({
    name: column.name,
    type: fieldTypeOf(column.columnType),
  }));
  const builder = createFrameBuilder({ refId: context.refId, fields, maxRows: context.maxRows });
  for (const row of result.rows) {
    if (!builder.add(fields.map((field, column) => frameValue(field.type, row[column])))) break;
  }
  return builder.build(durationMs);
}

/**
 * Runs a bound SQL query, reading one row more than the limit so the frame can say it was cut.
 *
 * @param pool - The pool.
 * @param query - The bound query.
 * @param context - The execution context.
 * @returns One frame.
 * @throws {ConnectorError} On any failure, with a message that quotes no data.
 */
async function execute(pool: Pool, query: SqlQuery, context: ExecutionContext): Promise<Frame[]> {
  const started = performance.now();
  const rowLimit = Math.trunc(context.maxRows) + 1;
  try {
    const result = await withSession(pool, rowLimit, context.signal, (session) =>
      streamRows(session, query.text, query.parameters, rowLimit),
    );
    return [toFrame(result, context, performance.now() - started)];
  } catch (error) {
    throw toConnectorError(error);
  }
}

/**
 * The row of {@link healthQuery}: the server version (which names MariaDB on MariaDB), the user
 * with its host, and how many write grants it has.
 */
type HealthRow = [version?: string, user?: string, writeGrants?: number];

/**
 * Checks the connection and whether the user can write. The server must be the kind's product.
 *
 * @param pool - The pool.
 * @param product - The kind's product.
 * @param signal - The caller's signal.
 * @returns The health report.
 */
async function test(pool: Pool, product: Product, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const { rows } = await withSession(pool, 1, metadataSignal(signal), (session) =>
      streamRows(session, healthQuery, [], 1),
    );
    const [version, user, grants] = (rows[0] ?? []) as HealthRow;
    const readOnly = Number(grants ?? 1) === 0;
    const access = readOnly ? 'has no write grants' : 'can write: use a read-only user';
    const server: Product = version?.includes('MariaDB') ? 'MariaDB' : 'MySQL';
    const named = `${server} ${version ?? '?'}.`;
    if (server !== product) {
      const message = `${named} Add it as a ${server} connector.`;
      return { ok: false, latencyMs: latencyMs(), message, readOnly };
    }
    const message = `${named} User ${user ?? '?'} ${access}.`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly };
  } catch (error) {
    const message = toConnectorError(error).safeMessage;
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}

/**
 * Reads distinct values of a column, after checking the column exists, so identifiers are never
 * taken from the caller unchecked.
 *
 * @param pool - The pool.
 * @param field - The table and column.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values and whether there are more.
 * @throws {ConnectorError} `not_found` when the column does not exist.
 */
async function sampleValues(pool: Pool, field: FieldReference, limit: number, signal: AbortSignal) {
  const rowLimit = Math.trunc(limit) + 1;
  try {
    const { rows } = await withSession(pool, rowLimit, metadataSignal(signal), async (session) => {
      const exists = `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`;
      const found = await streamRows(session, exists, [field.entity, field.field], 1);
      if (found.rows.length === 0) {
        throw new ConnectorError(
          'not_found',
          `Column "${field.entity}.${field.field}" does not exist.`,
        );
      }
      const column = quoteIdentifier(field.field);
      const distinct = `SELECT DISTINCT CAST(${column} AS CHAR) FROM ${quoteIdentifier(field.entity)} WHERE ${column} IS NOT NULL LIMIT ${rowLimit}`;
      return streamRows(session, distinct, [], rowLimit);
    });
    const all = rows.map((row) => String(row[0]));
    return { values: all.slice(0, limit), complete: all.length <= limit };
  } catch (error) {
    throw toConnectorError(error);
  }
}

/**
 * Reads the schema from `information_schema`.
 *
 * @param pool - The pool.
 * @param signal - The caller's signal.
 * @returns The schema snapshot.
 */
async function describe(pool: Pool, signal: AbortSignal) {
  try {
    const { fields, rows } = await withSession(
      pool,
      catalogRowLimit,
      metadataSignal(signal),
      (session) => streamRows(session, catalogQuery, [], catalogRowLimit),
    );
    const names = fields.map((field) => field.name);
    const records = rows.map(
      (row) =>
        Object.fromEntries(names.map((name, index) => [name, row[index]])) as unknown as CatalogRow,
    );
    return { entities: toEntities(records) };
  } catch (error) {
    throw toConnectorError(error);
  }
}

/**
 * Closes a pool.
 *
 * @param pool - The pool.
 * @returns Once every connection is closed.
 */
function closePool(pool: Pool): Promise<void> {
  return new Promise((resolve) => {
    pool.end(() => resolve());
  });
}

/** What sets one product apart: its identifier, name and logo. */
export interface MysqlProduct {
  /** The kind identifier, also the scheme of its target, such as `mariadb`. */
  readonly kind: string;
  /** The product, as its version string names it. */
  readonly name: Product;
  /** Its logo. */
  readonly icon: ConnectorIcon;
}

/**
 * Declares the connector kind of MySQL or MariaDB.
 *
 * @param product - The product's identifier, name and logo.
 * @returns The kind.
 */
export function defineMysqlKind(product: MysqlProduct) {
  return defineConnector({
    kind: product.kind,
    displayName: product.name,
    icon: product.icon,
    language: 'sql',
    dialect: 'mysql',
    queryGuide: mysqlGuide(product.name),
    configSchema,
    secretSchema,
    describeTarget: (config) =>
      `${product.kind}://${config.username}@${config.host}:${config.port}/${config.database}`,
    open({ config, secret }): ConnectorInstance {
      const pool = openPool({ ...config, password: secret.password });
      return {
        test: (signal) => test(pool, product.name, signal),
        describe: (signal) => describe(pool, signal),
        sampleValues: (field, limit, signal) => sampleValues(pool, field, limit, signal),
        execute: (query, context) =>
          query.language === 'sql'
            ? execute(pool, query, context)
            : Promise.reject(
                new ConnectorError('rejected', `${product.name} connectors run SQL queries only.`),
              ),
        close: () => closePool(pool),
      };
    },
  });
}
