/** The one error type connectors throw. */

/** Why a connector call can fail. */
const connectorErrorCodes = [
  'unreachable',
  'authentication',
  'permission',
  'syntax',
  'not_found',
  'timeout',
  'rejected',
  'internal',
] as const;

/** Why a connector call failed. The gate and the UI switch on this. */
export type ConnectorErrorCode = (typeof connectorErrorCodes)[number];

/**
 * The brand every copy of the class carries. A plugin that bundles its own copy of the kit by
 * mistake still throws errors the core recognises, since the symbol is global.
 */
const brand = Symbol.for('querent.connector-error');

/** The codes, to check a branded error's code. */
const knownCodes: ReadonlySet<unknown> = new Set(connectorErrorCodes);

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

  /**
   * Whether a value is a connector error: an instance of this class, or of another copy of it, by
   * the brand, with a known code and a safe message. So `instanceof` holds across copies.
   *
   * @param value - The value.
   * @returns `true` for a connector error.
   */
  static override [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { [brand]?: unknown; code?: unknown; safeMessage?: unknown };
    return (
      candidate[brand] === true &&
      knownCodes.has(candidate.code) &&
      typeof candidate.safeMessage === 'string'
    );
  }
}

Object.defineProperty(ConnectorError.prototype, brand, { value: true });
