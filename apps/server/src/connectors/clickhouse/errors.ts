/** Turns ClickHouse server errors into ConnectorErrors whose safe message quotes no data. */
import { ConnectorError } from '../_shared/index.ts';

/** What ClickHouse says when a query fails: `Code: 62. DB::Exception: …. (SYNTAX_ERROR)`. */
export interface ServerError {
  /** The error code, such as `62`. */
  readonly code: number;
  /** The error name, such as `SYNTAX_ERROR`, or an empty string. */
  readonly name: string;
  /** The whole message, which may quote values. */
  readonly message: string;
}

/** The message of a wrong value, whose own text quotes it. */
const wrongValue: [ConnectorError['code'], string] = [
  'syntax',
  'An argument or value has the wrong type or format.',
];

/** The message of a query stopped at the timeout. */
const timedOut: [ConnectorError['code'], string] = [
  'timeout',
  'The query was cancelled: it ran longer than the timeout, or the caller gave up.',
];

/** The message of a refused login. */
const loginRefused: [ConnectorError['code'], string] = [
  'authentication',
  'The username or password was refused.',
];

/** Safe messages by error code, for errors whose message may quote values. */
const messagesByCode: Readonly<Record<number, [ConnectorError['code'], string]>> = {
  62: ['syntax', 'The query has a syntax error.'],
  192: loginRefused,
  193: loginRefused,
  194: loginRefused,
  516: loginRefused,
  497: ['permission', "The connector's user may not read this."],
  81: ['not_found', 'The database does not exist.'],
  164: ['rejected', 'The query tried to write or change a setting; connectors only read.'],
  159: timedOut,
  160: timedOut,
  394: timedOut,
  158: ['rejected', 'The query went over a server limit on rows, bytes or memory.'],
  241: ['rejected', 'The query went over a server limit on rows, bytes or memory.'],
  307: ['rejected', 'The query went over a server limit on rows, bytes or memory.'],
  396: ['rejected', 'The query went over a server limit on rows, bytes or memory.'],
  6: wrongValue,
  27: wrongValue,
  38: wrongValue,
  41: wrongValue,
  43: wrongValue,
  53: wrongValue,
  69: wrongValue,
  70: wrongValue,
  72: wrongValue,
  386: wrongValue,
  456: ['syntax', 'The query uses a parameter that has no value.'],
  457: wrongValue,
};

/** Codes whose message names a missing thing, which is schema rather than data. */
const missingByCode: Readonly<Record<number, string>> = {
  16: 'Column',
  47: 'Column',
  60: 'Table',
  46: 'Function',
};

/**
 * Reads a ClickHouse error text.
 *
 * @param text - The body of a failed response, or the text after an exception marker.
 * @param headerCode - The `X-ClickHouse-Exception-Code` header, when there is one.
 * @returns The error.
 */
export function parseServerError(text: string, headerCode?: string | null): ServerError {
  const code = Number(/Code: (\d+)\./.exec(text)?.[1] ?? headerCode ?? 0);
  const name = /\(([A-Z][A-Z0-9_]*)\)(?: \(version .*\))?\s*$/m.exec(text)?.[1] ?? '';
  return { code, name, message: text.trim() };
}

/**
 * The first name a message quotes, in backticks or single quotes.
 *
 * @param message - The server's message.
 * @returns The name, or `?`.
 */
function quotedName(message: string): string {
  const body = message.replace(/^Code: \d+\. DB::Exception: /, '');
  return /[`']([^`'\n]{1,200})[`']/.exec(body)?.[1] ?? '?';
}

/**
 * Converts a server error into a ConnectorError. The whole message is kept as `message`, for people
 * allowed to see the data.
 *
 * @param error - The server error.
 * @returns The connector error.
 */
export function toConnectorError(error: ServerError): ConnectorError {
  const missing = missingByCode[error.code];
  if (missing !== undefined) {
    const safe = `${missing} "${quotedName(error.message)}" does not exist.`;
    return new ConnectorError('not_found', safe, error.message);
  }
  const [code, safe] = messagesByCode[error.code] ?? [
    'internal',
    `ClickHouse reported error ${error.code}${error.name ? ` (${error.name})` : ''}.`,
  ];
  return new ConnectorError(code, safe, error.message);
}
