/**
 * A quanthea connector plugin: SQLite files in one directory, read-only. It shows what a plugin is:
 * one bundled module that exports the kit version it was built for and, as default, a function
 * that receives the live kit and returns its connector kinds. It runs SQL in the `ansi` dialect
 * with `?` placeholders and `LIMIT`; the core binds every value and checks every statement.
 *
 * A file opens only under QUANTHEA_SQLITE_ROOT, read-only and with writes refused by `query_only`.
 * SQLite runs in the server's process: a slow query holds it until it ends, so keep to small
 * files. Times are ISO 8601 text in UTC, and the time range binds as such.
 */
import { Database } from 'bun:sqlite';
import type {
  BoundQuery,
  ConnectorInstance,
  ConnectorKit,
  ExecutionContext,
  FieldReference,
  Frame,
  HealthReport,
  SqlParameter,
} from '@quanthea/plugin-kit';
import { describeFile, sampleColumn } from './catalog.ts';
import { resolveInRoot, rootVariable } from './fence.ts';
import { frameOf } from './frames.ts';

/** The kit version this plugin is built for. */
export const kitVersion = 1;

/** How to get data from a SQLite file, for the agent. */
const queryGuide = `SQLite file (standard SQL, read-only). Times are ISO 8601 text in UTC, and :__from and :__to bind as such, so compare them with columns that hold ISO text: created_at BETWEEN :__from AND :__to.
- long over time: SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) AS time, status AS series, count(*) AS value FROM orders WHERE created_at BETWEEN :__from AND :__to GROUP BY 1, 2 ORDER BY 1. The SQL builders write no time buckets on this kind.
- long by category: SELECT status, count(*) AS value FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 10.
- single: SELECT count(*) AS value FROM orders WHERE status = :status.
- rows: SELECT * FROM orders ORDER BY created_at DESC LIMIT 50.`;

/** The SQLite logo, from Simple Icons (CC0). */
const icon = {
  color: '#003B57',
  path: 'M21.678.521c-1.032-.92-2.28-.55-3.513.544a8.71 8.71 0 0 0-.547.535c-2.109 2.237-4.066 6.38-4.674 9.544.237.48.422 1.093.544 1.561a13.044 13.044 0 0 1 .164.703s-.019-.071-.096-.296l-.05-.146a1.689 1.689 0 0 0-.033-.08c-.138-.32-.518-.995-.686-1.289-.143.423-.27.818-.376 1.176.484.884.778 2.4.778 2.4s-.025-.099-.147-.442c-.107-.303-.644-1.244-.772-1.464-.217.804-.304 1.346-.226 1.478.152.256.296.698.422 1.186.286 1.1.485 2.44.485 2.44l.017.224a22.41 22.41 0 0 0 .056 2.748c.095 1.146.273 2.13.5 2.657l.155-.084c-.334-1.038-.47-2.399-.41-3.967.09-2.398.642-5.29 1.661-8.304 1.723-4.55 4.113-8.201 6.3-9.945-1.993 1.8-4.692 7.63-5.5 9.788-.904 2.416-1.545 4.684-1.931 6.857.666-2.037 2.821-2.912 2.821-2.912s1.057-1.304 2.292-3.166c-.74.169-1.955.458-2.362.629-.6.251-.762.337-.762.337s1.945-1.184 3.613-1.72C21.695 7.9 24.195 2.767 21.678.521m-18.573.543A1.842 1.842 0 0 0 1.27 2.9v16.608a1.84 1.84 0 0 0 1.835 1.834h9.418a22.953 22.953 0 0 1-.052-2.707c-.006-.062-.011-.141-.016-.2a27.01 27.01 0 0 0-.473-2.378c-.121-.47-.275-.898-.369-1.057-.116-.197-.098-.31-.097-.432 0-.12.015-.245.037-.386a9.98 9.98 0 0 1 .234-1.045l.217-.028c-.017-.035-.014-.065-.031-.097l-.041-.381a32.8 32.8 0 0 1 .382-1.194l.2-.019c-.008-.016-.01-.038-.018-.053l-.043-.316c.63-3.28 2.587-7.443 4.8-9.791.066-.069.133-.128.198-.194Z',
};

/**
 * A bound parameter as SQLite takes it: a time as ISO text, a boolean as 0 or 1.
 *
 * @param value - The value the core bound.
 * @returns The value for SQLite.
 */
function sqliteValue(value: SqlParameter): string | number | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** A file opened on first use, read-only. */
interface FileConnection {
  /** The open file, opened now if not yet. */
  readonly connection: () => Database;
  /** Closes it. */
  readonly close: () => void;
}

/**
 * Opens a connector's file on first use: under the root, read-only, writes refused.
 *
 * @param kit - The kit.
 * @param file - The file, relative to the root.
 * @returns The opener.
 */
function fileConnection(kit: ConnectorKit, file: string): FileConnection {
  let database: Database | undefined;
  return {
    connection: () => {
      if (database) return database;
      const resolved = resolveInRoot(file, process.env[rootVariable]);
      if ('problem' in resolved)
        throw new kit.ConnectorError(
          'permission',
          `This file cannot be opened: ${resolved.problem}.`,
        );
      database = new Database(resolved.path, { readonly: true });
      database.run('PRAGMA query_only = ON');
      return database;
    },
    close: () => {
      database?.close();
      database = undefined;
    },
  };
}

/**
 * Runs a bound query, its failures as connector errors.
 *
 * @param kit - The kit.
 * @param database - The file.
 * @param query - The bound query.
 * @param context - The execution context.
 * @returns The frames.
 */
function execute(
  kit: ConnectorKit,
  database: () => Database,
  query: BoundQuery,
  context: ExecutionContext,
): Frame[] {
  if (query.language !== 'sql')
    throw new kit.ConnectorError('rejected', 'A SQLite file runs SQL only.');
  if (context.signal.aborted)
    throw new kit.ConnectorError('timeout', 'The query was cancelled before it started.');
  try {
    return [run(kit, database(), query.text, query.parameters, context)];
  } catch (error) {
    if (error instanceof kit.ConnectorError) throw error;
    throw new kit.ConnectorError('syntax', 'SQLite refused the query.', String(error));
  }
}

/**
 * A connector over one file, opened on first use.
 *
 * @param kit - The kit.
 * @param file - The file, relative to the root.
 * @returns The connection.
 */
function openFile(kit: ConnectorKit, file: string): ConnectorInstance {
  const { connection, close } = fileConnection(kit, file);
  return {
    test: async (signal) => test(kit, connection, file, signal),
    describe: async () => describeFile(connection()),
    sampleValues: async (field: FieldReference, limit: number) => {
      const values = sampleColumn(connection(), field.entity, field.field, limit);
      if (!values)
        throw new kit.ConnectorError(
          'not_found',
          `"${field.entity}" has no column "${field.field}".`,
        );
      return { values: values.slice(0, limit), complete: values.length <= limit };
    },
    execute: async (query, context) => execute(kit, connection, query, context),
    close: async () => close(),
  };
}

/**
 * Runs a bound statement and reads one row more than the row limit.
 *
 * @param kit - The kit.
 * @param database - The file.
 * @param text - The statement, with `?` placeholders.
 * @param parameters - Their values.
 * @param context - The execution context.
 * @returns The frame.
 */
function run(
  kit: ConnectorKit,
  database: Database,
  text: string,
  parameters: readonly SqlParameter[],
  context: ExecutionContext,
): Frame {
  const started = performance.now();
  const statement = database.query(text);
  const rows: unknown[][] = [];
  for (const row of statement.iterate(...parameters.map(sqliteValue))) {
    rows.push(statement.columnNames.map((name) => (row as Record<string, unknown>)[name]));
    if (rows.length > context.maxRows) break;
  }
  const result = { columns: statement.columnNames, declared: statement.declaredTypes, rows };
  return frameOf(kit, result, context, performance.now() - started);
}

/**
 * Checks the file opens and reads.
 *
 * @param kit - The kit.
 * @param connection - Opens the file.
 * @param file - The file, for the message.
 * @param signal - The caller's signal.
 * @returns The health report.
 */
async function test(
  kit: ConnectorKit,
  connection: () => Database,
  file: string,
  signal: AbortSignal,
): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = () => Math.round(performance.now() - started);
  try {
    if (signal.aborted) throw new kit.ConnectorError('timeout', 'The test was cancelled.');
    const version = connection().query<{ v: string }, []>('SELECT sqlite_version() AS v').get()?.v;
    const message = `SQLite ${version ?? '?'}, ${file}, opened read-only.`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly: true };
  } catch (error) {
    const message =
      error instanceof kit.ConnectorError ? error.safeMessage : 'The file cannot be read.';
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}

/**
 * The plugin: one connector kind, a SQLite file.
 *
 * @param kit - The live kit quanthea passes at load.
 * @returns The kinds.
 */
export default function plugin(kit: ConnectorKit) {
  return [
    kit.defineConnector({
      kind: 'sqlite-file',
      displayName: 'SQLite file',
      icon,
      aliases: ['sqlite', 'file'],
      language: 'sql',
      dialect: 'ansi',
      placeholders: '?',
      rowLimit: 'limit',
      queryGuide,
      configSchema: kit.z.object({
        file: kit.z
          .string()
          .trim()
          .min(1)
          .meta({
            title: 'Database file',
            description: `A path relative to ${rootVariable}, the directory the server reads files from.`,
            examples: ['shop.db'],
          }),
      }),
      secretSchema: kit.z.object({}),
      describeTarget: (config) => `sqlite:${config.file}`,
      open: ({ config }) => openFile(kit, config.file),
    }),
  ];
}
