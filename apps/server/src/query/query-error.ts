/** The errors of the query engine. */
import type { ConnectorError } from '../connectors/_shared/index.ts';

/** Why a query did not run or failed. */
export type QueryErrorCode =
  /** The template or its variables are invalid: an unknown variable, a second statement. */
  | 'invalid'
  /** A guardrail refused the query: the time range is too long. */
  | 'guardrail'
  /** The query ran longer than the timeout, or the caller gave up. */
  | 'timeout'
  /** The connector failed; `cause` holds the ConnectorError. */
  | 'connector';

/**
 * A query that did not run or failed. `safeMessage` quotes no data from the source; `message` may,
 * when a connector error carries the source's own text.
 */
export class QueryError extends Error {
  /** Why the query failed. */
  readonly code: QueryErrorCode;
  /** A message that quotes no data. */
  readonly safeMessage: string;
  /** The connector error, when the connector failed. */
  readonly connectorError: ConnectorError | undefined;

  /**
   * Creates the error.
   *
   * @param code - Why the query failed.
   * @param safeMessage - A message that quotes no data.
   * @param connectorError - The connector error behind it, if any.
   */
  constructor(code: QueryErrorCode, safeMessage: string, connectorError?: ConnectorError) {
    super(
      connectorError?.message ?? safeMessage,
      connectorError ? { cause: connectorError } : undefined,
    );
    this.name = 'QueryError';
    this.code = code;
    this.safeMessage = safeMessage;
    this.connectorError = connectorError;
  }
}
