/**
 * The ClickHouse connector kind: SQL over the HTTP interface, values as query parameters,
 * read-only, in UTC, with the row cap and the timeout applied by the server and the reader.
 */
import type { Frame } from '@querent/shared';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  createFrameBuilder,
  defineConnector,
  type ExecutionContext,
  type FieldReference,
  type SqlQuery,
} from '../_shared/index.ts';
import { type CatalogRow, catalogQuery, quoteIdentifier, toEntities } from './catalog.ts';
import { fieldTypeOf, frameValue } from './columns.ts';
import { clickhouseGuide } from './guide.ts';
import { testConnection } from './health.ts';
import { clickhouseIcon } from './icon.ts';
import { type ClickhouseSession, openSession, type ResultRows } from './session.ts';

/** The configuration of a ClickHouse connector. */
const configSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).meta({
    title: 'URL',
    description: 'The HTTP interface: port 8123, or 8443 with HTTPS.',
    examples: ['http://clickhouse:8123'],
  }),
  database: z
    .string()
    .trim()
    .min(1)
    .default('default')
    .meta({ title: 'Database', examples: ['analytics'] }),
  username: z
    .string()
    .trim()
    .min(1)
    .default('default')
    .meta({
      title: 'Username',
      description: 'SELECT grants, or readonly=2. A readonly=1 user cannot take the row cap.',
      examples: ['dash_ro'],
    }),
  verifyTls: z.boolean().default(true).meta({ title: 'Verify the TLS certificate' }),
});

/** The credentials of a ClickHouse connector. */
const secretSchema = z.object({
  password: z.string().default('').meta({ title: 'Password' }),
});

/** How long schema reads and samples may take, in milliseconds. */
const metadataTimeoutMs = 30_000;

/** The row cap of schema reads: one row per column. */
const catalogRowLimit = 100_000;

/**
 * Turns result rows into a frame, with fields typed from the result columns.
 *
 * @param result - The columns and rows.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @returns The frame.
 */
function toFrame(result: ResultRows, context: ExecutionContext, durationMs: number): Frame {
  const fields = result.columns.map((column) => ({
    name: column.name,
    type: fieldTypeOf(column.type),
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
 * @param session - The session.
 * @param query - The bound query.
 * @param context - The execution context.
 * @returns One frame.
 * @throws {ConnectorError} On any failure, with a message that quotes no data.
 */
async function execute(
  session: ClickhouseSession,
  query: SqlQuery,
  context: ExecutionContext,
): Promise<Frame[]> {
  const started = performance.now();
  const result = await session.run({
    sql: query.text,
    parameters: query.parameters,
    rowLimit: Math.trunc(context.maxRows) + 1,
    timeoutMs: context.timeoutMs,
    signal: context.signal,
  });
  return [toFrame(result, context, performance.now() - started)];
}

/**
 * Runs a metadata statement: bounded by the metadata timeout as well as the caller's signal.
 *
 * @param session - The session.
 * @param sql - The statement.
 * @param parameters - The values of its placeholders.
 * @param rowLimit - The most rows to read.
 * @param signal - The caller's signal.
 * @returns The rows.
 */
function runMetadata(
  session: ClickhouseSession,
  sql: string,
  parameters: readonly string[],
  rowLimit: number,
  signal: AbortSignal,
): Promise<ResultRows> {
  return session.run({
    sql,
    parameters,
    rowLimit,
    timeoutMs: metadataTimeoutMs,
    signal: AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)]),
  });
}

/**
 * Reads distinct values of a column, after checking the column exists, so identifiers are never
 * taken from the caller unchecked.
 *
 * @param session - The session.
 * @param field - The table and column.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values and whether there are more.
 * @throws {ConnectorError} `not_found` when the column does not exist.
 */
async function sampleValues(
  session: ClickhouseSession,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
) {
  const exists = `SELECT 1 FROM system.columns
    WHERE database = currentDatabase() AND table = {p1:String} AND name = {p2:String}`;
  const found = await runMetadata(session, exists, [field.entity, field.field], 1, signal);
  if (found.rows.length === 0)
    throw new ConnectorError(
      'not_found',
      `Column "${field.entity}.${field.field}" does not exist.`,
    );
  const rowLimit = Math.trunc(limit) + 1;
  const column = quoteIdentifier(field.field);
  const distinct = `SELECT DISTINCT toString(${column}) FROM ${quoteIdentifier(field.entity)} WHERE ${column} IS NOT NULL LIMIT ${rowLimit}`;
  const { rows } = await runMetadata(session, distinct, [], rowLimit, signal);
  const all = rows.map((row) => String(row[0]));
  return { values: all.slice(0, limit), complete: all.length <= limit };
}

/**
 * Reads the schema from the system tables.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns The schema snapshot.
 */
async function describe(session: ClickhouseSession, signal: AbortSignal) {
  const { columns, rows } = await runMetadata(session, catalogQuery, [], catalogRowLimit, signal);
  const records = rows.map(
    (row) =>
      Object.fromEntries(
        columns.map((column, index) => [column.name, row[index]]),
      ) as unknown as CatalogRow,
  );
  return { entities: toEntities(records) };
}

/** The ClickHouse connector kind. */
export const clickhouseConnector = defineConnector({
  kind: 'clickhouse',
  displayName: 'ClickHouse',
  icon: clickhouseIcon,
  language: 'sql',
  dialect: 'clickhouse',
  queryGuide: clickhouseGuide,
  configSchema,
  secretSchema,
  describeTarget: (config) => {
    const url = new URL(config.url);
    url.username = '';
    url.password = '';
    return `${url.origin}/${config.database} as ${config.username}`;
  },
  open({ config, secret }): ConnectorInstance {
    const session = openSession({ ...config, password: secret.password });
    return {
      test: (signal) => testConnection(session, signal),
      describe: (signal) => describe(session, signal),
      sampleValues: (field, limit, signal) => sampleValues(session, field, limit, signal),
      execute: (query, context) =>
        query.language === 'sql'
          ? execute(session, query, context)
          : Promise.reject(
              new ConnectorError('rejected', 'ClickHouse connectors run SQL queries only.'),
            ),
      close: () => Promise.resolve(),
    };
  },
});
