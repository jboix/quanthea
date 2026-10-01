/**
 * Statements over the Trino client protocol: each runs in a read-only transaction, in UTC, with the
 * timeout as a session property. Values are literals in an `EXECUTE IMMEDIATE … USING` list, never
 * in the statement. Pages are read up to a row limit, and the query is cancelled past it.
 */
import {
  ConnectorError,
  createHttpClient,
  type HttpClient,
  type HttpResponse,
  type SqlParameter,
} from '../_shared/index.ts';
import { type TrinoError, toConnectorError } from './errors.ts';

/** How a connector reaches Trino. */
export interface SessionOptions {
  /** The coordinator, such as `http://trino:8080`. */
  readonly url: string;
  /** The catalog unqualified names resolve in. */
  readonly catalog: string;
  /** The schema unqualified names resolve in. */
  readonly schema: string;
  /** The user. */
  readonly username: string;
  /** The password, for a coordinator with password authentication. */
  readonly password?: string | undefined;
  /** Whether to check the server certificate. */
  readonly verifyTls: boolean;
}

/** One statement to run. */
export interface Statement {
  /** The SQL, with `?` placeholders. */
  readonly sql: string;
  /** The value of each placeholder, in order. */
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
  /** The Trino type, such as `timestamp(3) with time zone`. */
  readonly type: string;
}

/** The columns and rows of a statement, read up to a limit. */
export interface ResultRows {
  /** The result columns. */
  readonly columns: readonly ResultColumn[];
  /** The rows, as arrays in column order. */
  readonly rows: readonly (readonly unknown[])[];
}

/** A connection to one Trino coordinator. */
export interface TrinoSession {
  /**
   * Runs a read statement in a read-only transaction.
   *
   * @param statement - The statement, its values and its limits.
   * @returns The columns and at most `rowLimit` rows.
   * @throws {ConnectorError} When the statement fails, is cancelled or tries to write.
   */
  run(statement: Statement): Promise<ResultRows>;
}

/** One page of results. */
interface QueryPage {
  /** The link to the next page, absent on the last one. */
  readonly nextUri?: string;
  /** The result columns, once known. */
  readonly columns?: readonly ResultColumn[];
  /** Rows of this page. */
  readonly data?: readonly unknown[][];
  /** Why the query failed. */
  readonly error?: TrinoError;
}

/** Statuses a client retries: the coordinator is busy or restarting. */
const retryStatuses = new Set([502, 503, 504]);

/** How long ending a transaction or cancelling a query may take, in milliseconds. */
const cleanupTimeoutMs = 5000;

/**
 * Writes a value as a Trino literal.
 *
 * @param value - The value.
 * @returns A string literal with its quotes doubled, a UTC timestamp, a double, a boolean or NULL.
 */
export function literalOf(value: SqlParameter): string {
  if (value === null) return 'NULL';
  if (value instanceof Date)
    return `TIMESTAMP '${value.toISOString().replace('T', ' ').replace('Z', '')} UTC'`;
  if (typeof value === 'number') return `DOUBLE '${value}'`;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The text Trino runs: the statement as is, or with values an `EXECUTE IMMEDIATE` with the
 * statement as a string and the values as literals.
 *
 * @param sql - The statement, with `?` placeholders.
 * @param parameters - The values, in order.
 * @returns The text.
 */
export function statementText(sql: string, parameters: readonly SqlParameter[]): string {
  if (parameters.length === 0) return sql;
  return `EXECUTE IMMEDIATE ${literalOf(sql)} USING ${parameters.map(literalOf).join(', ')}`;
}

/**
 * Reads one page, or the error a failed response carries.
 *
 * @param response - The response.
 * @returns The page.
 * @throws {ConnectorError} For a status that is not 2xx.
 */
async function pageOf(response: HttpResponse): Promise<QueryPage> {
  if (response.ok) return (await response.json()) as QueryPage;
  const text = await response.text();
  if (response.status === 401)
    throw new ConnectorError('authentication', 'The username or password was refused.', text);
  throw new ConnectorError('internal', `Trino answered with HTTP ${response.status}.`, text);
}

/**
 * Sends a request, retrying while the coordinator says it is busy.
 *
 * @param send - Sends the request once.
 * @returns The response.
 */
async function withRetries(send: () => Promise<HttpResponse>): Promise<HttpResponse> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await send();
    if (!retryStatuses.has(response.status) || attempt === 4) return response;
    await response.cancel();
    await Bun.sleep(100 * attempt);
  }
}

/** A statement's rows, and the transaction it started or ended. */
interface StatementResult extends ResultRows {
  /** The transaction the statement started, from `X-Trino-Started-Transaction-Id`. */
  readonly startedTransaction?: string | undefined;
}

/** What a query reads, page after page. */
interface PageReader {
  /** The HTTP client. */
  readonly client: HttpClient;
  /** The caller's signal. */
  readonly signal: AbortSignal;
  /** The most rows to read. */
  readonly rowLimit: number;
  /** The columns, once known. */
  columns: readonly ResultColumn[];
  /** The rows read. */
  readonly rows: unknown[][];
  /** The transaction the statement started. */
  startedTransaction?: string | undefined;
}

/**
 * Takes one page: its columns, rows, error and transaction.
 *
 * @param reader - What was read so far.
 * @param response - The page's response.
 * @returns The page.
 * @throws {ConnectorError} When the page reports an error.
 */
async function takePage(reader: PageReader, response: HttpResponse): Promise<QueryPage> {
  reader.startedTransaction ??= response.headers.get('x-trino-started-transaction-id') ?? undefined;
  const page = await pageOf(response);
  if (page.error) throw toConnectorError(page.error);
  reader.columns = page.columns ?? reader.columns;
  reader.rows.push(...(page.data ?? []));
  return page;
}

/**
 * Cancels a query that is still running. A failure is ignored: Trino ends abandoned queries.
 *
 * @param client - The HTTP client.
 * @param nextUri - The query's next page.
 * @returns Once the cancel is sent.
 */
async function cancelQuery(client: HttpClient, nextUri: string): Promise<void> {
  const signal = AbortSignal.timeout(cleanupTimeoutMs);
  await client
    .request({ method: 'DELETE', path: nextUri, signal })
    .then((response) => response.cancel())
    .catch(() => undefined);
}

/**
 * Runs one statement and reads its pages up to a row limit, then cancels it if it still runs.
 *
 * @param reader - The client, signal and row limit.
 * @param text - The statement.
 * @param headers - The headers of this statement.
 * @returns The columns, rows and the transaction the statement started.
 */
async function runStatement(
  reader: PageReader,
  text: string,
  headers: Readonly<Record<string, string>>,
): Promise<StatementResult> {
  const { client, signal } = reader;
  const post = () =>
    client.request({ method: 'POST', path: '/v1/statement', headers, body: text, signal });
  let page = await takePage(reader, await withRetries(post));
  try {
    while (page.nextUri !== undefined && reader.rows.length < reader.rowLimit) {
      const path = page.nextUri;
      page = await takePage(reader, await withRetries(() => client.request({ path, signal })));
    }
  } finally {
    if (page.nextUri !== undefined) await cancelQuery(client, page.nextUri);
  }
  const rows = reader.rows.slice(0, reader.rowLimit);
  return { columns: reader.columns, rows, startedTransaction: reader.startedTransaction };
}

/**
 * Runs a statement with its own reader.
 *
 * @param client - The HTTP client.
 * @param text - The statement.
 * @param headers - The headers of this statement.
 * @param options - The row limit and the signal.
 * @returns The result.
 */
function runOnce(
  client: HttpClient,
  text: string,
  headers: Readonly<Record<string, string>>,
  options: { readonly rowLimit: number; readonly signal: AbortSignal },
): Promise<StatementResult> {
  const reader: PageReader = { client, ...options, columns: [], rows: [] };
  return runStatement(reader, text, headers);
}

/**
 * The headers of every statement: the user, where names resolve, UTC, and the password.
 *
 * @param options - The session options.
 * @returns The headers.
 */
function sessionHeaders(options: SessionOptions): Record<string, string> {
  const credentials = Buffer.from(`${options.username}:${options.password ?? ''}`);
  return {
    'X-Trino-User': options.username,
    'X-Trino-Catalog': options.catalog,
    'X-Trino-Schema': options.schema,
    'X-Trino-Time-Zone': 'UTC',
    'X-Trino-Source': 'quanthea',
    ...(options.password ? { Authorization: `Basic ${credentials.toString('base64')}` } : {}),
  };
}

/**
 * Runs a statement in a read-only transaction, which is rolled back after it.
 *
 * @param client - The HTTP client.
 * @param statement - The statement.
 * @returns The rows.
 * @throws {ConnectorError} When Trino starts no transaction, or the statement fails.
 */
async function runReadOnly(client: HttpClient, statement: Statement): Promise<ResultRows> {
  const { signal } = statement;
  const start = await runOnce(
    client,
    'START TRANSACTION READ ONLY',
    { 'X-Trino-Transaction-Id': 'NONE' },
    { rowLimit: 1, signal },
  );
  const transaction = start.startedTransaction;
  if (transaction === undefined)
    throw new ConnectorError('internal', 'Trino started no read-only transaction.');
  try {
    const headers = {
      'X-Trino-Transaction-Id': transaction,
      'X-Trino-Session': `query_max_execution_time=${Math.max(1, Math.trunc(statement.timeoutMs))}ms`,
    };
    const text = statementText(statement.sql, statement.parameters);
    return await runOnce(client, text, headers, { rowLimit: statement.rowLimit, signal });
  } finally {
    const cleanup = { rowLimit: 1, signal: AbortSignal.timeout(cleanupTimeoutMs) };
    void runOnce(client, 'ROLLBACK', { 'X-Trino-Transaction-Id': transaction }, cleanup).catch(
      () => undefined,
    );
  }
}

/**
 * Opens a session. It sends nothing until the first statement.
 *
 * @param options - Where and how to connect.
 * @returns The session.
 */
export function openSession(options: SessionOptions): TrinoSession {
  const client = createHttpClient({
    baseUrl: options.url,
    sourceName: 'Trino',
    headers: sessionHeaders(options),
    verifyTls: options.verifyTls,
  });
  return { run: (statement) => runReadOnly(client, statement) };
}
