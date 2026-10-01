/**
 * Queries over the InfluxDB 3 HTTP API: SQL to `/api/v3/query_sql`, values as named parameters,
 * the answer read one JSON line at a time up to a row limit, the connection closed past it. The
 * query endpoint runs no DML, so nothing sent there writes.
 */
import {
  ConnectorError,
  createHttpClient,
  type HttpClient,
  type SqlParameter,
} from '../_shared/index.ts';
import { toConnectorError } from './errors.ts';

/** How a connector reaches InfluxDB. */
export interface SessionOptions {
  /** The server, such as `http://influxdb:8181`. */
  readonly url: string;
  /** The database. */
  readonly database: string;
  /** The token, when the server asks for one. */
  readonly token?: string | undefined;
  /** Whether to check the server certificate. */
  readonly verifyTls: boolean;
}

/** The rows of a query, read up to a limit, and the columns they hold. */
export interface ResultRows {
  /** The columns, in the order they first appear. */
  readonly columns: readonly string[];
  /** The rows, as objects; a null value has no key. */
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/** What the server says about itself. */
export interface ServerInfo {
  /** Such as `InfluxDB 3 Core`. */
  readonly product: string;
  /** Such as `3.11.5`. */
  readonly version: string;
}

/** A connection to one InfluxDB 3 server and database. */
export interface InfluxSession {
  /**
   * Runs a query.
   *
   * @param sql - The SQL, with `$pN` placeholders.
   * @param parameters - The value of each placeholder: `pN` is the Nth.
   * @param rowLimit - The most rows to read.
   * @param signal - Aborts the query.
   * @returns The columns and rows.
   * @throws {ConnectorError} When the query fails or the server cannot be reached.
   */
  query(
    sql: string,
    parameters: readonly SqlParameter[],
    rowLimit: number,
    signal: AbortSignal,
  ): Promise<ResultRows>;
  /**
   * Reads the server's name and version.
   *
   * @param signal - Aborts the request.
   * @returns The server.
   * @throws {ConnectorError} When the server cannot be reached or refuses the token.
   */
  ping(signal: AbortSignal): Promise<ServerInfo>;
}

/**
 * A value as a JSON parameter: a time as ISO text.
 *
 * @param value - The value.
 * @returns The JSON value.
 */
function parameterValue(value: SqlParameter): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Parses one line of the answer.
 *
 * @param line - The line.
 * @returns The row.
 * @throws {ConnectorError} `internal` when the line is not a JSON object.
 */
function parseRow(line: string): Record<string, unknown> {
  try {
    const row: unknown = JSON.parse(line);
    if (row !== null && typeof row === 'object' && !Array.isArray(row))
      return row as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  throw new ConnectorError('internal', 'InfluxDB sent a line that is not a JSON object.');
}

/**
 * Reads the rows of an answer up to a limit.
 *
 * @param lines - The answer, line by line.
 * @param rowLimit - The most rows to read.
 * @returns The columns and rows.
 */
async function readRows(lines: AsyncIterable<string>, rowLimit: number): Promise<ResultRows> {
  const columns = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for await (const line of lines) {
    if (line.trim() === '') continue;
    const row = parseRow(line);
    for (const key of Object.keys(row)) columns.add(key);
    rows.push(row);
    if (rows.length >= rowLimit) break;
  }
  return { columns: [...columns], rows };
}

/**
 * Opens a session. It sends nothing until the first query.
 *
 * @param options - Where and how to connect.
 * @returns The session.
 */
export function openSession(options: SessionOptions): InfluxSession {
  const client: HttpClient = createHttpClient({
    baseUrl: options.url,
    sourceName: 'InfluxDB',
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
    verifyTls: options.verifyTls,
  });
  return {
    async query(sql, parameters, rowLimit, signal) {
      const params = Object.fromEntries(
        parameters.map((value, index) => [`p${index + 1}`, parameterValue(value)]),
      );
      const response = await client.request({
        method: 'POST',
        path: '/api/v3/query_sql',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db: options.database, q: sql, params, format: 'jsonl' }),
        signal,
      });
      if (!response.ok) throw toConnectorError(response.status, await response.text());
      return readRows(response.lines(), rowLimit);
    },
    async ping(signal) {
      const response = await client.request({ path: '/ping', signal });
      if (!response.ok) throw toConnectorError(response.status, await response.text());
      const answer = (await response.json()) as { product_name?: string; version?: string };
      return { product: answer.product_name ?? 'InfluxDB 3', version: answer.version ?? '?' };
    },
  };
}
