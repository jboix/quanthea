/** The one error type connectors throw. */

/** Why a connector call failed. The gate and the UI switch on this. */
export type ConnectorErrorCode =
  | 'unreachable'
  | 'authentication'
  | 'permission'
  | 'syntax'
  | 'not_found'
  | 'timeout'
  | 'rejected'
  | 'internal';

/**
 * A failed connector call. `message` is the source's own text and may quote data, such as a value in
 * a type error; only people allowed to see the data get it. `safeMessage` must quote no data: the
 * model receives it whatever the connector's access level.
 */
export class ConnectorError extends Error {
  /** Why the call failed. */
  readonly code: ConnectorErrorCode;
  /** A description that quotes no values from the source. Identifiers are fine. */
  readonly safeMessage: string;

  /**
   * Creates the error.
   *
   * @param code - Why the call failed.
   * @param safeMessage - A description that quotes no values from the source.
   * @param message - The source's own message, which may quote values. Defaults to `safeMessage`.
   * @param options - The underlying error, as `cause`.
   */
  constructor(
    code: ConnectorErrorCode,
    safeMessage: string,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(message ?? safeMessage, options);
    this.name = 'ConnectorError';
    this.code = code;
    this.safeMessage = safeMessage;
  }
}
