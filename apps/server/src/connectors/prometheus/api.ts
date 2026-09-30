/** A small client for the Prometheus HTTP API: GET requests, JSON envelopes, typed errors. */
import { ConnectorError, createHttpClient } from '../_shared/index.ts';

/** How to reach a Prometheus server. */
export interface ApiOptions {
  /** The base URL, such as `http://prometheus:9090`. */
  readonly url: string;
  /** Headers sent with every request, such as `Authorization`. */
  readonly headers: Readonly<Record<string, string>>;
  /** Whether to check the server certificate. */
  readonly verifyTls: boolean;
}

/** Sends GET requests to the Prometheus API. */
export interface PrometheusApi {
  /**
   * Sends a GET request and returns the `data` of a successful envelope.
   *
   * @param path - The API path, such as `/api/v1/query`.
   * @param parameters - Query string parameters; an array value repeats the parameter.
   * @param signal - Aborts the request.
   * @returns The `data` field and any warnings.
   * @throws {ConnectorError} When the request fails or Prometheus answers with an error.
   */
  get<T>(
    path: string,
    parameters: Readonly<Record<string, string | string[]>>,
    signal: AbortSignal,
  ): Promise<ApiResult<T>>;
}

/** A successful response. */
export interface ApiResult<T> {
  /** The `data` field. */
  readonly data: T;
  /** Warnings, such as "results truncated due to limit". */
  readonly warnings: readonly string[];
}

/** The JSON envelope of every Prometheus API response. */
interface Envelope<T> {
  /** `success` or `error`. */
  readonly status?: string;
  /** The payload of a successful response. */
  readonly data?: T;
  /** The error class of a failed response, such as `bad_data`. */
  readonly errorType?: string;
  /** The error text of a failed response. */
  readonly error?: string;
  /** Warnings. */
  readonly warnings?: readonly string[];
}

/** Connector error codes for Prometheus error types. */
const codesByErrorType: Readonly<Record<string, ConnectorError['code']>> = {
  bad_data: 'syntax',
  timeout: 'timeout',
  canceled: 'timeout',
  execution: 'rejected',
  not_found: 'not_found',
  unavailable: 'unreachable',
};

/**
 * Removes quoted literals from a Prometheus message. Label values in a query or its error can be
 * data, so the safe message keeps the structure of the error and drops the literals.
 *
 * @param message - The message from Prometheus.
 * @returns The message with every `"…"` and `'…'` literal replaced.
 */
export function redactLiterals(message: string): string {
  return message.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '"…"');
}

/**
 * Turns an error envelope into a connector error.
 *
 * @param envelope - The envelope, if the body was JSON.
 * @param status - The HTTP status.
 * @returns The connector error.
 */
function envelopeError(envelope: Envelope<unknown> | undefined, status: number): ConnectorError {
  if (status === 401)
    return new ConnectorError('authentication', 'Prometheus refused the credentials.');
  if (status === 403) return new ConnectorError('permission', 'Prometheus refused access.');
  const message = envelope?.error ?? `HTTP ${status}`;
  const code = codesByErrorType[envelope?.errorType ?? ''] ?? 'internal';
  return new ConnectorError(
    code,
    `Prometheus: ${redactLiterals(message)}`,
    `Prometheus: ${message}`,
  );
}

/**
 * Creates the API client.
 *
 * @param options - The server URL, headers and TLS setting.
 * @returns The client.
 */
export function createPrometheusApi(options: ApiOptions): PrometheusApi {
  const client = createHttpClient({
    baseUrl: options.url,
    sourceName: 'Prometheus',
    headers: { Accept: 'application/json', ...options.headers },
    verifyTls: options.verifyTls,
  });
  return {
    async get<T>(
      path: string,
      parameters: Readonly<Record<string, string | string[]>>,
      signal: AbortSignal,
    ) {
      const response = await client.request({ path, query: parameters, signal });
      const envelope = (await response.json().catch((error: unknown) => {
        if (error instanceof ConnectorError && error.code !== 'internal') throw error;
        return undefined;
      })) as Envelope<T> | undefined;
      if (!response.ok || envelope?.status !== 'success' || envelope.data === undefined) {
        throw envelopeError(envelope, response.status);
      }
      return { data: envelope.data, warnings: envelope.warnings ?? [] };
    },
  };
}
