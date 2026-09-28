/** Turns driver errors into ConnectorErrors whose safe message quotes no data. */
import { ConnectorError } from '../_shared/index.ts';

/** What the driver's errors carry: the SQLSTATE and the server's message. */
interface DriverError {
  /** The SQLSTATE, such as `42601`, or a Node error code such as `ECONNREFUSED`. */
  readonly code?: string;
  /** The server's message, which may quote values. */
  readonly message?: string;
}

/** Safe messages for SQLSTATEs whose server message may quote values. */
const messagesByState: Readonly<Record<string, [ConnectorError['code'], string]>> = {
  '42601': ['syntax', 'The query has a syntax error.'],
  '42501': ['permission', "The connector's role may not read this."],
  '25006': ['rejected', 'The query tried to write; connectors only read.'],
  '0A000': ['rejected', 'The statement is not supported: connectors run one read statement.'],
  '57014': [
    'timeout',
    'The query was cancelled: it ran longer than the timeout, or the caller gave up.',
  ],
  '28P01': ['authentication', 'The username or password was refused.'],
  '28000': ['authentication', 'The role may not connect.'],
  '3D000': ['not_found', 'The database does not exist.'],
};

/** Node network errors that mean the server cannot be reached. */
const networkCodes = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'CONNECT_TIMEOUT',
]);

/**
 * The quoted identifier of an "undefined table/column" message. Identifiers are schema, not data.
 *
 * @param message - The server's message.
 * @returns The identifier, or `undefined`.
 */
function quotedIdentifier(message: string): string | undefined {
  return /"([^"]{1,200})"/.exec(message)?.[1];
}

/**
 * The code and safe message for an error the server raised.
 *
 * @param state - The SQLSTATE.
 * @param message - The server's message.
 * @returns The connector error code and a message that quotes no data.
 */
function describeState(state: string, message: string): [ConnectorError['code'], string] {
  const known = messagesByState[state];
  if (known) return known;
  const identifier = quotedIdentifier(message);
  if (state === '42P01')
    return ['not_found', `Table or view "${identifier ?? '?'}" does not exist.`];
  if (state === '42703') return ['not_found', `Column "${identifier ?? '?'}" does not exist.`];
  if (state.startsWith('22'))
    return ['syntax', `A value has the wrong type or format (SQLSTATE ${state}).`];
  if (state.startsWith('08')) return ['unreachable', 'The connection to the database failed.'];
  return ['internal', `The database reported an error (SQLSTATE ${state}).`];
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
  const code = driverError.code ?? '';
  if (networkCodes.has(code)) {
    return new ConnectorError('unreachable', 'The database cannot be reached.', message, {
      cause: error,
    });
  }
  if (!/^[0-9A-Z]{5}$/.test(code)) {
    return new ConnectorError('internal', 'The database driver failed.', message, { cause: error });
  }
  const [connectorCode, safeMessage] = describeState(code, message);
  return new ConnectorError(connectorCode, safeMessage, message, { cause: error });
}
