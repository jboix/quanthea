/** Turns Elasticsearch and OpenSearch error answers into ConnectorErrors that quote no data. */
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
}

/** Safe messages by error type. */
const messagesByType: Readonly<Record<string, [ConnectorError['code'], string]>> = {
  parsing_exception: ['syntax', 'The search body has an error.'],
  x_content_parse_exception: ['syntax', 'The search body has an error.'],
  illegal_argument_exception: ['syntax', 'The search uses an argument the server refuses.'],
  query_shard_exception: ['syntax', 'The query has an error.'],
  number_format_exception: ['syntax', 'A value has the wrong type or format.'],
  too_many_buckets_exception: ['rejected', 'The search asks for too many buckets.'],
  circuit_breaking_exception: ['rejected', 'The search went over a server memory limit.'],
  es_rejected_execution_exception: ['rejected', 'The server is too busy to run the search.'],
  task_cancelled_exception: [
    'timeout',
    'The query was cancelled: it ran longer than the timeout, or the caller gave up.',
  ],
};

/**
 * The most telling error of an answer: the first root cause, or the error itself.
 *
 * @param error - The error.
 * @returns The error to describe.
 */
function causeOf(error: ServerError): ServerError {
  return error.root_cause?.[0]?.type ? error.root_cause[0] : error;
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
  return new ConnectorError(code, safe, message);
}
