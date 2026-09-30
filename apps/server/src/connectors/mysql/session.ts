/**
 * Connections to MySQL and MariaDB: a small pool whose sessions are read-only and in UTC, statements
 * run as prepared statements, rows streamed up to a limit, and a `KILL QUERY` when the caller gives
 * up.
 */
import mysql, { type FieldPacket, type Pool, type PoolConnection } from 'mysql2';
import { ConnectorError, type SqlParameter } from '../_shared/index.ts';

/** How a pool connects. */
export interface PoolOptions {
  /** The server name or address. */
  readonly host: string;
  /** The port. */
  readonly port: number;
  /** The database. */
  readonly database: string;
  /** The user. */
  readonly username: string;
  /** The password. */
  readonly password: string;
  /** Whether and how TLS is used. */
  readonly tls: 'verify-full' | 'require' | 'disable';
}

/** The rows of a statement, read up to a limit. */
export interface StreamedRows {
  /** The result columns. */
  readonly fields: readonly FieldPacket[];
  /** The rows, as arrays in column order. */
  readonly rows: readonly (readonly unknown[])[];
}

/** A session in use: its connection, and a way to say it cannot go back to the pool. */
interface Session {
  /** The connection. */
  readonly connection: PoolConnection;
  /** Marks the connection as spent: it is closed instead of reused. */
  readonly spend: () => void;
}

/** Connections whose session is already read-only. */
const readOnlySessions = new WeakSet<PoolConnection>();

/**
 * Opens a pool. It connects on the first statement. Local files and multiple statements are off,
 * and code generation is off, so the driver runs no generated code.
 *
 * @param options - Where and how to connect.
 * @returns The pool.
 */
export function openPool(options: PoolOptions): Pool {
  const ssl =
    options.tls === 'disable' ? undefined : { rejectUnauthorized: options.tls === 'verify-full' };
  return mysql.createPool({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.username,
    password: options.password,
    ...(ssl ? { ssl } : {}),
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 30_000,
    connectTimeout: 10_000,
    timezone: 'Z',
    decimalNumbers: true,
    supportBigNumbers: true,
    disableEval: true,
    multipleStatements: false,
    flags: ['-LOCAL_FILES', '-MULTI_STATEMENTS'],
  });
}

/**
 * Takes a connection from the pool.
 *
 * @param pool - The pool.
 * @returns The connection.
 */
function connectionOf(pool: Pool): Promise<PoolConnection> {
  return new Promise((resolve, reject) => {
    pool.getConnection((error, connection) => (error ? reject(error) : resolve(connection)));
  });
}

/**
 * Runs a statement to its end.
 *
 * @param connection - The connection.
 * @param sql - The statement, with `?` placeholders.
 * @param values - The placeholder values.
 * @returns The rows, as objects.
 */
function run(
  connection: PoolConnection,
  sql: string,
  values: readonly SqlParameter[] = [],
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    connection.execute(sql, [...values], (error, rows) =>
      error ? reject(error) : resolve(rows as unknown[]),
    );
  });
}

/**
 * Makes a session read-only once, then sets the time zone and the row cap for this use. Read-only
 * sessions refuse writes and schema changes on every statement, in or out of a transaction.
 *
 * @param connection - The connection.
 * @param rowLimit - The most rows a SELECT returns without its own LIMIT.
 */
async function prepareSession(connection: PoolConnection, rowLimit: number): Promise<void> {
  if (!readOnlySessions.has(connection)) {
    await run(connection, 'SET SESSION TRANSACTION READ ONLY');
    readOnlySessions.add(connection);
  }
  const limit = Math.max(1, Math.trunc(rowLimit));
  await run(connection, `SET SESSION time_zone = '+00:00', SESSION sql_select_limit = ${limit}`);
}

/**
 * Runs work in a read-only session. When the signal fires, the running statement is killed and the
 * connection is closed rather than reused.
 *
 * @param pool - The pool.
 * @param rowLimit - The most rows a SELECT returns without its own LIMIT.
 * @param signal - The caller's signal.
 * @param work - The statements to run.
 * @returns What `work` returns.
 * @throws {ConnectorError} `timeout` when the signal fired before the work started.
 */
export async function withSession<T>(
  pool: Pool,
  rowLimit: number,
  signal: AbortSignal,
  work: (session: Session) => Promise<T>,
): Promise<T> {
  if (signal.aborted)
    throw new ConnectorError('timeout', 'The query was cancelled before it started.');
  const connection = await connectionOf(pool);
  let reusable = true;
  const spend = (): void => {
    reusable = false;
  };
  const kill = (): void => {
    spend();
    pool.query(`KILL QUERY ${Math.trunc(connection.threadId)}`, () => undefined);
  };
  signal.addEventListener('abort', kill, { once: true });
  try {
    await prepareSession(connection, rowLimit);
    return await work({ connection, spend });
  } finally {
    signal.removeEventListener('abort', kill);
    if (reusable) connection.release();
    else connection.destroy();
  }
}

/**
 * Runs a prepared statement and reads its rows up to a limit. Past the limit it stops reading and
 * spends the connection, which still has rows to send.
 *
 * @param session - The session.
 * @param sql - The statement, with `?` placeholders.
 * @param values - The placeholder values.
 * @param maxRows - The most rows to read.
 * @returns The columns and the rows.
 */
export function streamRows(
  session: Session,
  sql: string,
  values: readonly SqlParameter[],
  maxRows: number,
): Promise<StreamedRows> {
  return new Promise((resolve, reject) => {
    const rows: unknown[][] = [];
    let fields: readonly FieldPacket[] = [];
    const statement = session.connection.execute({ sql, rowsAsArray: true }, [...values]);
    statement.on('fields', (packets: unknown) => {
      fields = packets as FieldPacket[];
    });
    statement.on('result', (row: unknown) => {
      if (rows.length >= maxRows) return;
      rows.push(row as unknown[]);
      if (rows.length < maxRows) return;
      session.spend();
      resolve({ fields, rows });
    });
    statement.on('error', reject);
    statement.on('end', () => resolve({ fields, rows }));
  });
}
