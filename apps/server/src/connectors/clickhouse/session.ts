/**
 * Statements over the ClickHouse HTTP interface: values sent as query parameters, never in the SQL;
 * read-only, in UTC, with a row cap and a timeout the server applies; rows read line by line up to
 * a limit, and the connection closed past it.
 */
import {
  ConnectorError,
  createHttpClient,
  type HttpClient,
  type HttpResponse,
  type SqlParameter,
} from '../_shared/index.ts';
import { parseServerError, toConnectorError } from './errors.ts';

/** How a connector reaches ClickHouse. */
export interface SessionOptions {
  /** The HTTP interface, such as `http://clickhouse:8123`. */
  readonly url: string;
  /** The database unqualified names resolve in. */
  readonly database: string;
  /** The user. */
  readonly username: string;
  /** The password. */
  readonly password: string;
  /** Whether to check the server certificate. */
  readonly verifyTls: boolean;
}

/** One statement to run. */
export interface Statement {
  /** The SQL, with `{pN:Type}` placeholders. */
  readonly sql: string;
  /** The value of each placeholder: `pN` is the Nth. */
  readonly parameters: readonly SqlParameter[];
  /** The most rows to read. */
  readonly rowLimit: number;
  /** The server-side timeout, in milliseconds. */
  readonly timeoutMs: number;
  /** Aborted when the caller gives up. */
  readonly signal: AbortSignal;
}

/** One result column. */
export interface ResultColumn {
  /** The column name. */
  readonly name: string;
  /** The ClickHouse type, such as `Nullable(DateTime64(3, 'UTC'))`. */
  readonly type: string;
}

/** The columns and rows of a statement, read up to a limit. */
export interface ResultRows {
  /** The result columns. */
  readonly columns: readonly ResultColumn[];
  /** The rows, as arrays in column order. */
  readonly rows: readonly (readonly unknown[])[];
}

/** What the server says about the connector's user. */
export interface Access {
  /** The server version, such as `26.8.15.10`. */
  readonly version: string;
  /** The user name. */
  readonly user: string;
  /** The user's `readonly` setting: 0 can write, 1 cannot change settings, 2 can only read. */
  readonly readonly: number;
}

/** A connection to one ClickHouse server. */
export interface ClickhouseSession {
  /**
   * Reads what the server says about the user, once: later calls reuse the answer.
   *
   * @returns The version, the user and its `readonly` setting.
   * @throws {ConnectorError} When the server cannot be reached or refuses the credentials.
   */
  access(): Promise<Access>;
  /**
   * Runs a read statement.
   *
   * @param statement - The statement, its values and its limits.
   * @returns The columns and at most `rowLimit` rows.
   * @throws {ConnectorError} When the statement fails, or the user's `readonly` is 1.
   */
  run(statement: Statement): Promise<ResultRows>;
}

/** The output format: names, then types, then one JSON array per row. */
const outputFormat = 'JSONCompactEachRowWithNamesAndTypes';

/** The line that opens and closes an error written after the rows started. */
const exceptionMarker = '__exception__';

/** How long reading the user's access may take, in milliseconds. */
const accessTimeoutMs = 10_000;

/** The error for a user whose `readonly` is 1, which refuses every setting the connector needs. */
export const readonlyOneError = new ConnectorError(
  'rejected',
  "The ClickHouse user has readonly=1, which refuses the connector's row cap, timeout and time zone. Give it readonly=2, or no readonly setting and SELECT grants only.",
);

/**
 * Writes a value the way ClickHouse reads query parameters: escaped text, `\N` for null.
 *
 * @param value - The value.
 * @returns The text.
 */
export function parameterText(value: SqlParameter): string {
  if (value === null) return '\\N';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace('Z', '');
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
}

/**
 * The settings of a statement: read-only unless the user already is, a timeout, a row cap that
 * stops rather than fails, UTC, ISO times and unquoted big integers.
 *
 * @param access - The user's access.
 * @param statement - The statement.
 * @returns The settings, as query parameters.
 * @throws {ConnectorError} When the user's `readonly` is 1.
 */
function settingsFor(access: Access, statement: Statement): Record<string, string> {
  if (access.readonly === 1) throw readonlyOneError;
  return {
    ...(access.readonly === 0 ? { readonly: '1' } : {}),
    max_execution_time: String(Math.max(0.001, statement.timeoutMs / 1000)),
    max_result_rows: String(statement.rowLimit),
    result_overflow_mode: 'break',
    session_timezone: 'UTC',
    date_time_output_format: 'iso',
    output_format_json_quote_64bit_integers: '0',
    cancel_http_readonly_queries_on_client_close: '1',
  };
}

/**
 * The error a failed response carries.
 *
 * @param response - The response, whose status is not 2xx.
 * @returns The connector error.
 */
async function failureOf(response: HttpResponse): Promise<ConnectorError> {
  const text = await response.text();
  const error = parseServerError(text, response.headers.get('x-clickhouse-exception-code'));
  if (error.code !== 0) return toConnectorError(error);
  const code = response.status === 401 ? 'authentication' : 'internal';
  return new ConnectorError(code, `ClickHouse answered with HTTP ${response.status}.`, text);
}

/** What {@link readRows} has read so far. */
interface ReadState {
  /** The column names, from the first line. */
  names?: readonly string[];
  /** The column types, from the second line. */
  types?: readonly string[];
  /** The rows read. */
  readonly rows: unknown[][];
  /** The lines of an error written after the rows started, once its marker is seen. */
  exception?: string[];
}

/**
 * Takes one line of the output.
 *
 * @param state - What was read so far.
 * @param line - The line.
 * @throws {ConnectorError} `internal` for a line that is not JSON.
 */
function acceptLine(state: ReadState, line: string): void {
  if (state.exception) state.exception.push(line);
  else if (line === exceptionMarker) state.exception = [];
  else if (line !== '') {
    const values = parseLine(line);
    if (state.names === undefined) state.names = values.map(String);
    else if (state.types === undefined) state.types = values.map(String);
    else state.rows.push(values);
  }
}

/**
 * Parses one line of the output.
 *
 * @param line - The line.
 * @returns Its values.
 * @throws {ConnectorError} `internal` when the line is not a JSON array.
 */
function parseLine(line: string): unknown[] {
  try {
    const values: unknown = JSON.parse(line);
    if (Array.isArray(values)) return values;
  } catch {
    // Reported below: the query probably chose another output format.
  }
  throw new ConnectorError(
    'internal',
    'ClickHouse sent a line that is not a JSON array. Remove any FORMAT clause from the query.',
  );
}

/**
 * Reads the output of a statement up to a row limit. Stopping early closes the connection, which
 * cancels the statement on the server.
 *
 * @param lines - The output, line by line.
 * @param rowLimit - The most rows to read.
 * @returns The columns and the rows.
 * @throws {ConnectorError} For an error written after the rows started, or output that is not
 *   the expected format.
 */
export async function readRows(
  lines: AsyncIterable<string>,
  rowLimit: number,
): Promise<ResultRows> {
  const state: ReadState = { rows: [] };
  for await (const line of lines) {
    acceptLine(state, line);
    if (!state.exception && state.rows.length >= rowLimit) break;
  }
  if (state.exception) throw toConnectorError(parseServerError(state.exception.join('\n')));
  const names = state.names ?? [];
  const columns = names.map((name, index) => ({ name, type: state.types?.[index] ?? 'String' }));
  return { columns, rows: state.rows };
}

/**
 * Sends a statement with its settings and values.
 *
 * @param client - The HTTP client.
 * @param options - The session options.
 * @param statement - The statement.
 * @param settings - The settings.
 * @returns The rows.
 */
async function send(
  client: HttpClient,
  options: SessionOptions,
  statement: Statement,
  settings: Readonly<Record<string, string>>,
): Promise<ResultRows> {
  const parameters = Object.fromEntries(
    statement.parameters.map((value, index) => [`param_p${index + 1}`, parameterText(value)]),
  );
  const response = await client.request({
    method: 'POST',
    path: '/',
    query: {
      database: options.database,
      default_format: outputFormat,
      query_id: crypto.randomUUID(),
      ...settings,
      ...parameters,
    },
    body: statement.sql,
    signal: statement.signal,
  });
  if (!response.ok) throw await failureOf(response);
  if (response.headers.get('x-clickhouse-format') !== outputFormat) {
    await response.cancel();
    throw new ConnectorError('rejected', 'A query cannot choose its output format: remove FORMAT.');
  }
  return readRows(response.lines(), statement.rowLimit);
}

/**
 * Reads the version, the user and its `readonly` setting, with no setting of the connector's, so
 * a user whose `readonly` is 1 can answer.
 *
 * @param client - The HTTP client.
 * @param options - The session options.
 * @returns The access.
 */
async function readAccess(client: HttpClient, options: SessionOptions): Promise<Access> {
  const { rows } = await send(
    client,
    options,
    {
      sql: "SELECT version(), currentUser(), toUInt8(getSetting('readonly'))",
      parameters: [],
      rowLimit: 1,
      timeoutMs: accessTimeoutMs,
      signal: AbortSignal.timeout(accessTimeoutMs),
    },
    {},
  );
  const [version, user, readonly] = rows[0] ?? [];
  return { version: String(version), user: String(user), readonly: Number(readonly) };
}

/**
 * Opens a session. It sends nothing until the first statement.
 *
 * @param options - Where and how to connect.
 * @returns The session.
 */
export function openSession(options: SessionOptions): ClickhouseSession {
  const client = createHttpClient({
    baseUrl: options.url,
    sourceName: 'ClickHouse',
    headers: { 'X-ClickHouse-User': options.username, 'X-ClickHouse-Key': options.password },
    verifyTls: options.verifyTls,
  });
  let access: Promise<Access> | undefined;
  const accessOnce = (): Promise<Access> => {
    access ??= readAccess(client, options).catch((error: unknown) => {
      access = undefined;
      throw error;
    });
    return access;
  };
  return {
    access: accessOnce,
    run: async (statement) =>
      send(client, options, statement, settingsFor(await accessOnce(), statement)),
  };
}
