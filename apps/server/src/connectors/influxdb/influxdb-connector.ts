/**
 * The InfluxDB 3 connector kind: SQL over the HTTP API, values as named parameters, the row limit
 * applied by the reader. The query endpoint runs no DML, so the connector only reads.
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
  type HealthReport,
  type SchemaEntity,
  type SqlQuery,
} from '../_shared/index.ts';
import { fieldTypeOfName, frameValue, inferredType, nativeTypeOf } from './columns.ts';
import { influxdbGuide } from './guide.ts';
import { influxdbIcon } from './icon.ts';
import { type InfluxSession, openSession, type ResultRows } from './session.ts';

/** The configuration of an InfluxDB 3 connector. */
const configSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).meta({ title: 'URL', examples: ['http://influxdb:8181'] }),
  database: z
    .string()
    .trim()
    .min(1)
    .meta({ title: 'Database', examples: ['telemetry'] }),
  verifyTls: z.boolean().default(true).meta({ title: 'Verify the TLS certificate' }),
});

/** The credentials of an InfluxDB 3 connector. */
const secretSchema = z.object({
  token: z
    .string()
    .optional()
    .meta({ title: 'Token', description: 'Leave empty for a server started without auth.' }),
});

/** How long health checks, schema reads and samples may take, in milliseconds. */
const metadataTimeoutMs = 30_000;

/** How far back samples look, so they never scan the whole history. */
const sampleWindow = "INTERVAL '7 days'";

/** The tables and columns of the database, from the information schema. */
const catalogQuery = `SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema = 'iox' ORDER BY table_name, ordinal_position`;

/**
 * Turns result rows into a frame, each column typed from its values.
 *
 * @param result - The columns and rows.
 * @param context - The execution context.
 * @param durationMs - How long the query took.
 * @returns The frame.
 */
function toFrame(result: ResultRows, context: ExecutionContext, durationMs: number): Frame {
  const fields = result.columns.map((name) => ({
    name,
    type: inferredType(result.rows.map((row) => row[name])),
  }));
  const builder = createFrameBuilder({ refId: context.refId, fields, maxRows: context.maxRows });
  for (const row of result.rows) {
    if (!builder.add(fields.map((field) => frameValue(field.type, row[field.name])))) break;
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
 */
async function execute(
  session: InfluxSession,
  query: SqlQuery,
  context: ExecutionContext,
): Promise<Frame[]> {
  const started = performance.now();
  const rowLimit = Math.trunc(context.maxRows) + 1;
  const result = await session.query(query.text, query.parameters, rowLimit, context.signal);
  return [toFrame(result, context, performance.now() - started)];
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
 * Checks the server, the token and the database. A token cannot be limited to reading in InfluxDB
 * 3 Core, so the report says only that the connector reads.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns The health report.
 */
async function test(session: InfluxSession, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const server = await session.ping(bounded(signal));
    await session.query('SELECT 1', [], 1, bounded(signal));
    const message = `${server.product} ${server.version}. The connector only queries, and the query endpoint cannot write.`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly: null };
  } catch (error) {
    const message = error instanceof ConnectorError ? error.safeMessage : 'The test failed.';
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}

/**
 * Reads the tables and columns: measurements, their tags, fields and time.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns The schema snapshot.
 */
async function describe(session: InfluxSession, signal: AbortSignal) {
  const { rows } = await session.query(catalogQuery, [], 100_000, bounded(signal));
  const entities = new Map<string, SchemaEntity & { fields: SchemaEntity['fields'][number][] }>();
  for (const row of rows) {
    const table = String(row.table_name);
    const dataType = String(row.data_type);
    const entity = entities.get(table) ?? { name: table, kind: 'table' as const, fields: [] };
    entity.fields.push({
      name: String(row.column_name),
      nativeType: nativeTypeOf(dataType),
      type: fieldTypeOfName(dataType),
    });
    entities.set(table, entity);
  }
  return { entities: [...entities.values()] };
}

/**
 * Quotes an identifier.
 *
 * @param identifier - A table or column name the catalog has.
 * @returns The identifier in double quotes, inner quotes doubled.
 */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Reads distinct values of a column over the last week, after checking the column exists, so
 * identifiers are never taken from the caller unchecked.
 *
 * @param session - The session.
 * @param field - The table and column.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values and whether there are more.
 * @throws {ConnectorError} `not_found` when the column does not exist.
 */
async function sampleValues(
  session: InfluxSession,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
) {
  const exists = `SELECT 1 AS found FROM information_schema.columns
    WHERE table_schema = 'iox' AND table_name = $p1 AND column_name = $p2`;
  const found = await session.query(exists, [field.entity, field.field], 1, bounded(signal));
  if (found.rows.length === 0)
    throw new ConnectorError(
      'not_found',
      `Column "${field.entity}.${field.field}" does not exist.`,
    );
  const column = quoteIdentifier(field.field);
  const rowLimit = Math.trunc(limit) + 1;
  const distinct = `SELECT DISTINCT CAST(${column} AS VARCHAR) AS value FROM ${quoteIdentifier(field.entity)}
    WHERE ${column} IS NOT NULL AND time > now() - ${sampleWindow} LIMIT ${rowLimit}`;
  const { rows } = await session.query(distinct, [], rowLimit, bounded(signal));
  const all = rows.map((row) => String(row.value));
  return { values: all.slice(0, limit), complete: all.length <= limit };
}

/** The InfluxDB 3 connector kind. */
export const influxdbConnector = defineConnector({
  kind: 'influxdb',
  displayName: 'InfluxDB 3',
  icon: influxdbIcon,
  aliases: ['influx', 'time series'],
  language: 'sql',
  dialect: 'influxdb',
  queryGuide: influxdbGuide,
  configSchema,
  secretSchema,
  describeTarget: (config) => `${new URL(config.url).origin}/${config.database}`,
  open({ config, secret }): ConnectorInstance {
    const session = openSession({ ...config, token: secret.token || undefined });
    return {
      test: (signal) => test(session, signal),
      describe: (signal) => describe(session, signal),
      sampleValues: (field, limit, signal) => sampleValues(session, field, limit, signal),
      execute: (query, context) =>
        query.language === 'sql'
          ? execute(session, query, context)
          : Promise.reject(
              new ConnectorError('rejected', 'InfluxDB connectors run SQL queries only.'),
            ),
      close: () => Promise.resolve(),
    };
  },
});
