/** Turns driver errors into ConnectorErrors whose safe message quotes no data. */
import { ConnectorError } from '../_shared/index.ts';

/** What the driver's errors carry: the server's error number and message, or a network code. */
interface DriverError {
  /** The server's error number, such as `1064`. */
  readonly errno?: number;
  /** The error name, such as `ER_PARSE_ERROR`, or a Node error code such as `ECONNREFUSED`. */
  readonly code?: string;
  /** Whether the connection failed rather than the statement. */
  readonly fatal?: boolean;
  /** The message, which may quote values. */
  readonly message?: string;
}

/** Safe messages for server errors whose message may quote values. */
const messagesByNumber: Readonly<Record<number, [ConnectorError['code'], string]>> = {
  1064: ['syntax', 'The query has a syntax error.'],
  1044: ['permission', "The connector's user may not use this database."],
  1142: ['permission', "The connector's user may not read this."],
  1143: ['permission', "The connector's user may not read this."],
  1227: ['permission', "The connector's user may not do this."],
  1045: ['authentication', 'The username or password was refused.'],
  1049: ['not_found', 'The database does not exist.'],
  1792: ['rejected', 'The query tried to write; connectors only read.'],
  1317: [
    'timeout',
    'The query was cancelled: it ran longer than the timeout, or the caller gave up.',
  ],
  3024: ['timeout', 'The query ran longer than the timeout.'],
  1969: ['timeout', 'The query ran longer than the timeout.'],
  1292: ['syntax', 'A value has the wrong type or format.'],
  1366: ['syntax', 'A value has the wrong type or format.'],
  1305: ['not_found', 'A function or procedure the query calls does not exist.'],
};

/** Node and driver errors that mean the server cannot be reached. */
const networkCodes = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'PROTOCOL_CONNECTION_LOST',
]);

/**
 * The identifier an "unknown table or column" message quotes. Identifiers are schema, not data.
 *
 * @param message - The server's message.
 * @returns The identifier, or `?`.
 */
function quotedIdentifier(message: string): string {
  return /'([^']{1,200})'/.exec(message)?.[1] ?? '?';
}

/**
 * The code and safe message for an error the server raised.
 *
 * @param errno - The server's error number.
 * @param message - The server's message.
 * @returns The connector error code and a message that quotes no data.
 */
function describeNumber(errno: number, message: string): [ConnectorError['code'], string] {
  const known = messagesByNumber[errno];
  if (known) return known;
  if (errno === 1146) return ['not_found', `Table "${quotedIdentifier(message)}" does not exist.`];
  if (errno === 1054) return ['not_found', `Column "${quotedIdentifier(message)}" does not exist.`];
  return ['internal', `The database reported error ${errno}.`];
}

/**
 * Converts anything the driver throws into a ConnectorError. The raw message is kept as `message`,
 * for people allowed to see the data.
 *
 * @param error - What the driver threw.
 * @returns The connector error.
 */
export function toConnectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const driverError = (typeof error === 'object' && error !== null ? error : {}) as DriverError;
  const message = driverError.message ?? String(error);
  if (networkCodes.has(driverError.code ?? '')) {
    return new ConnectorError('unreachable', 'The database cannot be reached.', message, {
      cause: error,
    });
  }
  if (typeof driverError.errno !== 'number' || driverError.errno < 1000) {
    return new ConnectorError('internal', 'The database driver failed.', message, { cause: error });
  }
  const [code, safeMessage] = describeNumber(driverError.errno, message);
  return new ConnectorError(code, safeMessage, message, { cause: error });
}
