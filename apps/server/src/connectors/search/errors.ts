/**
 * Turns Elasticsearch and OpenSearch error answers into ConnectorErrors that quote no data. An
 * error about how the query is written carries the server's reason: the server raises it while it
 * reads the query, before it reads any document, so it quotes only what the query says. So does
 * the error of a script: the only scripts a search holds are in `bucket_script` and
 * `bucket_selector`, which receive bucket numbers, and its reason names types and operators.
 */
import { ConnectorError } from '../_shared/index.ts';

/** The error part of an error answer. */
export interface ServerError {
  /** The error type, such as `index_not_found_exception`. */
  readonly type?: string;
  /** The reason, which may quote values. */
  readonly reason?: string;
  /** The index a not-found error names. */
  readonly index?: string;
  /** The errors the shards reported, for a failed search. */
  readonly root_cause?: readonly ServerError[];
  /** The error behind this one, such as the script error behind a failed search. */
  readonly caused_by?: ServerError;
}

/** Safe messages by error type. */
const messagesByType: Readonly<Record<string, [ConnectorError['code'], string]>> = {
  parsing_exception: ['syntax', 'The search body has an error.'],
  x_content_parse_exception: ['syntax', 'The search body has an error.'],
  parse_exception: ['syntax', 'A value of the search cannot be read.'],
  action_request_validation_exception: ['syntax', 'The search request is not valid.'],
  illegal_argument_exception: ['syntax', 'The search uses an argument the server refuses.'],
  query_shard_exception: ['syntax', 'The query has an error.'],
  number_format_exception: ['syntax', 'A value has the wrong type or format.'],
  script_exception: ['syntax', 'A script of the search has an error.'],
  too_many_buckets_exception: ['rejected', 'The search asks for too many buckets.'],
  circuit_breaking_exception: ['rejected', 'The search went over a server memory limit.'],
  es_rejected_execution_exception: ['rejected', 'The server is too busy to run the search.'],
  task_cancelled_exception: [
    'timeout',
    'The query was cancelled: it ran longer than the timeout, or the caller gave up.',
  ],
};

/** The errors the server raises while it reads the query: their reason quotes the query only. */
const aboutTheQuery: ReadonlySet<string> = new Set([
  'parsing_exception',
  'x_content_parse_exception',
  'parse_exception',
  'action_request_validation_exception',
  'illegal_argument_exception',
  'query_shard_exception',
  'number_format_exception',
  'script_exception',
]);

/** The longest reason a safe message carries. */
const reasonLength = 300;

/**
 * The safe message of an error about the query, with the server's reason, so whoever wrote the
 * query can fix it.
 *
 * @param safe - The message of the error's type.
 * @param cause - The error.
 * @returns The message, with the reason when the error is about the query and has one.
 */
function withReason(safe: string, cause: ServerError): string {
  const reason = cause.reason?.replace(/\s+/g, ' ').trim();
  if (!reason || !aboutTheQuery.has(cause.type ?? '')) return safe;
  const cut = reason.length > reasonLength ? `${reason.slice(0, reasonLength)}…` : reason;
  return `${safe} The server says: ${cut}`;
}

/**
 * The error of a script, with why it failed: the server says `compile error` or `runtime error`,
 * and the error behind that says what is wrong.
 *
 * @param error - The script error.
 * @returns The error, with the reason of the error behind it when it has one.
 */
function scriptError(error: ServerError): ServerError {
  const behind = error.caused_by;
  const why = behind?.reason ?? behind?.type;
  return why === undefined ? error : { ...error, reason: `${error.reason ?? 'error'}: ${why}` };
}

/**
 * The most telling error of an answer: the first root cause, the script error behind a failed
 * search, which has no root cause, or the error itself.
 *
 * @param error - The error.
 * @returns The error to describe.
 */
function causeOf(error: ServerError): ServerError {
  const root = error.root_cause?.[0];
  const cause = root?.type ? root : (error.caused_by ?? error);
  if (cause.type === 'script_exception') return scriptError(cause);
  return root?.type ? root : error;
}

/**
 * Converts an error answer into a ConnectorError. The reason is kept as `message`, for people
 * allowed to see the data.
 *
 * @param status - The HTTP status.
 * @param error - The `error` of the answer, when it had one.
 * @param source - The server's name, for the messages.
 * @returns The connector error.
 */
export function toConnectorError(
  status: number,
  error: ServerError | undefined,
  source: string,
): ConnectorError {
  const cause = causeOf(error ?? {});
  const type = cause.type ?? `HTTP ${status}`;
  const message = `${type}: ${cause.reason ?? ''}`;
  if (status === 401)
    return new ConnectorError('authentication', `${source} refused the credentials.`, message);
  if (status === 403) return new ConnectorError('permission', `${source} refused access.`, message);
  if (type === 'index_not_found_exception') {
    const safe = `Index "${cause.index ?? '?'}" does not exist.`;
    return new ConnectorError('not_found', safe, message);
  }
  const [code, safe] = messagesByType[type] ?? ['internal', `${source} reported ${type}.`];
  return new ConnectorError(code, withReason(safe, cause), message);
}
