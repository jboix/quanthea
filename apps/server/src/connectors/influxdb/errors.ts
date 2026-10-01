/** Turns InfluxDB 3 errors, which come as text, into ConnectorErrors that quote no data. */
import { ConnectorError } from '../_shared/index.ts';

/** What a message says, how to classify it, and what to say safely. */
const patterns: readonly [RegExp, ConnectorError['code'], (match: RegExpExecArray) => string][] = [
  [/database not found/i, 'not_found', () => 'The database does not exist.'],
  [
    /table '([^']{1,200})' not found/i,
    'not_found',
    (match) => `Table "${match[1]?.split('.').at(-1)}" does not exist.`,
  ],
  [
    /No field named "?([^".\s]{1,200})"?/i,
    'not_found',
    (match) => `Column "${match[1]}" does not exist.`,
  ],
  [
    /DML not supported|not supported: (Insert|Update|Delete)/i,
    'rejected',
    () => 'The query tried to write; connectors only read.',
  ],
  [/TokenizerError|ParserError|SQL error/i, 'syntax', () => 'The query has a syntax error.'],
  [
    /Cast error|Arrow error|cannot be cast|Invalid argument/i,
    'syntax',
    () => 'An argument or value has the wrong type or format.',
  ],
  [
    /No function matches|Invalid function/i,
    'not_found',
    () => 'A function the query calls does not exist.',
  ],
];

/**
 * Converts an error answer into a ConnectorError. The text may quote values, so it is kept as
 * `message`, for people allowed to see the data.
 *
 * @param status - The HTTP status.
 * @param text - The body.
 * @returns The connector error.
 */
export function toConnectorError(status: number, text: string): ConnectorError {
  const message = `InfluxDB: ${text.trim().slice(0, 1000)}`;
  if (status === 401)
    return new ConnectorError('authentication', 'InfluxDB refused the token.', message);
  if (status === 403) return new ConnectorError('permission', 'InfluxDB refused access.', message);
  for (const [pattern, code, safe] of patterns) {
    const match = pattern.exec(text);
    if (match) return new ConnectorError(code, safe(match), message);
  }
  return new ConnectorError('internal', `InfluxDB failed (HTTP ${status}).`, message);
}
