/**
 * The Trino connector kind: SQL over the client protocol, each query in a read-only transaction,
 * in UTC, with the timeout as a session property and the row limit applied by the reader.
 */
import type { Frame } from '@quanthea/shared';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  createFrameBuilder,
  defineConnector,
  type ExecutionContext,
  type FieldReference,
  type HealthReport,
  type SqlParameter,
  type SqlQuery,
} from '../_shared/index.ts';
import {
  type ColumnRow,
  columnsQuery,
  commentsQuery,
  quoteIdentifier,
  toEntities,
} from './catalog.ts';
import { fieldTypeOf, frameValue } from './columns.ts';
import { trinoGuide } from './guide.ts';
import { trinoIcon } from './icon.ts';
import { openSession, type ResultRows, type TrinoSession } from './session.ts';

/** The configuration of a Trino connector. */
const configSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).meta({
    title: 'URL',
    description: 'The coordinator. A password needs HTTPS.',
    examples: ['https://trino.internal:8443'],
  }),
  catalog: z
    .string()
    .trim()
    .min(1)
    .meta({
      title: 'Catalog',
      examples: ['hive'],
    }),
  schema: z
    .string()
    .trim()
    .min(1)
    .meta({ title: 'Schema', examples: ['analytics'] }),
  username: z
    .string()
    .trim()
    .min(1)
    .meta({
      title: 'Username',
      examples: ['dash_ro'],
    }),
  verifyTls: z.boolean().default(true).meta({ title: 'Verify the TLS certificate' }),
});

/** The credentials of a Trino connector. */
const secretSchema = z.object({
  password: z.string().optional().meta({ title: 'Password' }),
});

/** How long health checks, schema reads and samples may take, in milliseconds. */
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
  session: TrinoSession,
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
  session: TrinoSession,
  sql: string,
  parameters: readonly SqlParameter[],
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
 * Checks the connection and the read-only transaction. Trino's access control cannot say whether
 * the user could write, so the report does not either.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns The health report.
 */
async function test(session: TrinoSession, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const { rows } = await runMetadata(session, 'SELECT version(), current_user', [], 1, signal);
    const [version, user] = rows[0] ?? [];
    const message = `Trino ${String(version)}. User ${String(user)}; every query runs in a read-only transaction.`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly: null };
  } catch (error) {
    const message = error instanceof ConnectorError ? error.safeMessage : 'The test failed.';
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
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
  session: TrinoSession,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
) {
  const exists = `SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema AND table_name = ? AND column_name = ?`;
  const found = await runMetadata(session, exists, [field.entity, field.field], 1, signal);
  if (found.rows.length === 0)
    throw new ConnectorError(
      'not_found',
      `Column "${field.entity}.${field.field}" does not exist.`,
    );
  const rowLimit = Math.trunc(limit) + 1;
  const column = quoteIdentifier(field.field);
  const distinct = `SELECT DISTINCT CAST(${column} AS varchar) FROM ${quoteIdentifier(field.entity)} WHERE ${column} IS NOT NULL LIMIT ${rowLimit}`;
  const { rows } = await runMetadata(session, distinct, [], rowLimit, signal);
  const all = rows.map((row) => String(row[0]));
  return { values: all.slice(0, limit), complete: all.length <= limit };
}

/**
 * Reads the table comments, which a catalog may not keep or the user may not read.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns The comments by table name, empty when they cannot be read.
 */
async function tableComments(session: TrinoSession, signal: AbortSignal) {
  const result = await runMetadata(session, commentsQuery, [], catalogRowLimit, signal).catch(
    () => ({ rows: [] }),
  );
  return new Map(result.rows.map((row) => [String(row[0]), String(row[1])]));
}

/**
 * Reads the schema from `information_schema`, with the table comments.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns The schema snapshot.
 */
async function describe(session: TrinoSession, signal: AbortSignal) {
  const { columns, rows } = await runMetadata(session, columnsQuery, [], catalogRowLimit, signal);
  const records = rows.map(
    (row) =>
      Object.fromEntries(
        columns.map((column, index) => [column.name, row[index]]),
      ) as unknown as ColumnRow,
  );
  return { entities: toEntities(records, await tableComments(session, signal)) };
}

/** The Trino connector kind. */
export const trinoConnector = defineConnector({
  kind: 'trino',
  displayName: 'Trino',
  icon: trinoIcon,
  language: 'sql',
  dialect: 'trino',
  queryGuide: trinoGuide,
  configSchema,
  secretSchema,
  describeTarget: (config) =>
    `${new URL(config.url).origin}/${config.catalog}/${config.schema} as ${config.username}`,
  open({ config, secret }): ConnectorInstance {
    const session = openSession({ ...config, password: secret.password });
    return {
      test: (signal) => test(session, signal),
      describe: (signal) => describe(session, signal),
      sampleValues: (field, limit, signal) => sampleValues(session, field, limit, signal),
      execute: (query, context) =>
        query.language === 'sql'
          ? execute(session, query, context)
          : Promise.reject(
              new ConnectorError('rejected', 'Trino connectors run SQL queries only.'),
            ),
      close: () => Promise.resolve(),
    };
  },
});
