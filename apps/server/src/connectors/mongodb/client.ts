/**
 * The MongoDB client of a connector, from its settings, and how the driver's errors become
 * connector errors. The client connects on its first command and keeps a small pool.
 */
import { MongoClient, type MongoClientOptions, MongoServerError } from 'mongodb';
import { ConnectorError } from '../_shared/index.ts';

/** How a connector reaches the server. */
export interface ClientOptions {
  /** The server name, or the DNS seed list name with `srv`. */
  readonly host: string;
  /** The port, unused with `srv`. */
  readonly port: number;
  /** Whether the host is a DNS seed list (`mongodb+srv://`), as MongoDB Atlas gives. */
  readonly srv: boolean;
  /** The user, or none to connect without one. */
  readonly username?: string | undefined;
  /** The password. */
  readonly password?: string | undefined;
  /** The database that holds the user, when it is not the one the connector reads. */
  readonly authSource?: string | undefined;
  /** The database the connector reads. */
  readonly database: string;
  /** Whether and how TLS is used. */
  readonly tls: 'verify-full' | 'require' | 'disable';
}

/** Server error codes and what they mean for a query. */
const serverCodes: ReadonlyMap<number, [ConnectorError['code'], string]> = new Map([
  [13, ['permission', "The connector's user may not read this collection."]],
  [18, ['authentication', 'The username or password was refused.']],
  [50, ['timeout', 'The query ran longer than the timeout.']],
  [26, ['not_found', 'The collection does not exist.']],
]);

/**
 * The connection URL, without credentials.
 *
 * @param options - Where to connect.
 * @returns Such as `mongodb://mongo.internal:27017/shop`.
 */
export function urlOf(options: ClientOptions): string {
  const database = encodeURIComponent(options.database);
  if (options.srv) return `mongodb+srv://${options.host}/${database}`;
  return `mongodb://${options.host}:${options.port}/${database}`;
}

/**
 * The driver options: credentials apart from the URL, short timeouts, a small pool.
 *
 * @param options - Where and how to connect.
 * @returns The driver options.
 */
function driverOptions(options: ClientOptions): MongoClientOptions {
  const authSource = options.authSource ? { authSource: options.authSource } : {};
  const credentials = options.username
    ? { auth: { username: options.username, password: options.password ?? '' }, ...authSource }
    : {};
  return {
    ...credentials,
    appName: 'quanthea',
    maxPoolSize: 5,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 10_000,
    retryWrites: false,
    tls: options.tls !== 'disable',
    ...(options.tls === 'require'
      ? { tlsAllowInvalidCertificates: true, tlsAllowInvalidHostnames: true }
      : {}),
  };
}

/**
 * Opens a client. It connects on its first command.
 *
 * @param options - Where and how to connect.
 * @returns The client.
 */
export function clientOf(options: ClientOptions): MongoClient {
  return new MongoClient(urlOf(options), driverOptions(options));
}

/**
 * Turns what the driver threw into a connector error. The server's message may quote a value.
 *
 * @param error - What the driver threw.
 * @param signal - The caller's signal, to tell a cancelled query.
 * @returns The connector error.
 */
export function toConnectorError(error: unknown, signal?: AbortSignal): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (signal?.aborted)
    return new ConnectorError(
      'timeout',
      'The query was cancelled: it ran longer than the timeout, or the caller gave up.',
      message,
    );
  if (error instanceof MongoServerError) return serverError(error);
  if (/Authentication failed|auth/i.test(message))
    return new ConnectorError('authentication', 'The username or password was refused.', message);
  if (/connect|Server selection|ENOTFOUND|ECONNREFUSED|timed out|querySrv/i.test(message))
    return new ConnectorError('unreachable', 'The server cannot be reached.', message);
  return new ConnectorError('internal', 'The server failed the query.', message);
}

/**
 * The connector error of a server error: by its code, or a refused pipeline.
 *
 * @param error - The server error.
 * @returns The connector error.
 */
function serverError(error: MongoServerError): ConnectorError {
  const known = typeof error.code === 'number' ? serverCodes.get(error.code) : undefined;
  if (known) return new ConnectorError(known[0], known[1], error.message);
  const name = error.codeName ? ` (${error.codeName})` : '';
  return new ConnectorError('syntax', `MongoDB refused the pipeline${name}.`, error.message);
}
