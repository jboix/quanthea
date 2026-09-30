/** Turns Trino query errors into ConnectorErrors whose safe message quotes no data. */
import { ConnectorError } from '../_shared/index.ts';

/** The error of a failed query, as Trino reports it. */
export interface TrinoError {
  /** The message, which may quote values. */
  readonly message?: string;
  /** The error name, such as `SYNTAX_ERROR`. */
  readonly errorName?: string;
  /** The error type, such as `USER_ERROR` or `INSUFFICIENT_RESOURCES`. */
  readonly errorType?: string;
}

/** The message of a wrong value, whose own text may quote it. */
const wrongValue: [ConnectorError['code'], string] = [
  'syntax',
  'An argument or value has the wrong type or format.',
];

/** The message of a query stopped before it finished. */
const cancelled: [ConnectorError['code'], string] = [
  'timeout',
  'The query was cancelled: it ran longer than the timeout, or the caller gave up.',
];

/** Safe messages by error name, for errors whose message may quote values. */
const messagesByName: Readonly<Record<string, [ConnectorError['code'], string]>> = {
  SYNTAX_ERROR: ['syntax', 'The query has a syntax error.'],
  READ_ONLY_VIOLATION: ['rejected', 'The query tried to write; connectors only read.'],
  PERMISSION_DENIED: ['permission', "The connector's user may not read this."],
  CATALOG_NOT_FOUND: ['not_found', 'The catalog does not exist.'],
  SCHEMA_NOT_FOUND: ['not_found', 'The schema does not exist.'],
  EXCEEDED_TIME_LIMIT: cancelled,
  USER_CANCELED: cancelled,
  ADMINISTRATIVELY_KILLED: cancelled,
  TYPE_MISMATCH: wrongValue,
  INVALID_CAST_ARGUMENT: wrongValue,
  INVALID_FUNCTION_ARGUMENT: wrongValue,
  INVALID_LITERAL: wrongValue,
  NUMERIC_VALUE_OUT_OF_RANGE: wrongValue,
  DIVISION_BY_ZERO: wrongValue,
  INVALID_PARAMETER_USAGE: ['syntax', 'The query and its parameters do not match.'],
};

/** Error names whose message names a missing thing, which is schema rather than data. */
const missingByName: Readonly<Record<string, string>> = {
  TABLE_NOT_FOUND: 'Table',
  COLUMN_NOT_FOUND: 'Column',
  FUNCTION_NOT_FOUND: 'Function',
};

/**
 * The first name a message quotes, in single quotes.
 *
 * @param message - The message.
 * @returns The name, or `?`.
 */
function quotedName(message: string): string {
  return /'([^'\n]{1,200})'/.exec(message)?.[1] ?? '?';
}

/**
 * Converts a query error into a ConnectorError. The whole message is kept as `message`, for people
 * allowed to see the data.
 *
 * @param error - The query error.
 * @returns The connector error.
 */
export function toConnectorError(error: TrinoError): ConnectorError {
  const name = error.errorName ?? 'GENERIC_INTERNAL_ERROR';
  const message = `${name}: ${error.message ?? ''}`;
  const missing = missingByName[name];
  if (missing !== undefined) {
    const safe = `${missing} "${quotedName(error.message ?? '')}" does not exist.`;
    return new ConnectorError('not_found', safe, message);
  }
  const known = messagesByName[name];
  if (known) return new ConnectorError(known[0], known[1], message);
  if (error.errorType === 'INSUFFICIENT_RESOURCES') {
    return new ConnectorError('rejected', 'The query went over a server limit.', message);
  }
  return new ConnectorError('internal', `Trino reported error ${name}.`, message);
}
