/** A small client for the Loki HTTP API: GET requests, JSON answers, errors that quote no data. */
import { ConnectorError, createHttpClient } from '../_shared/index.ts';

/** How to reach Loki. */
export interface ApiOptions {
  /** The base URL, such as `http://loki:3100`. */
  readonly url: string;
  /** Headers sent with every request: `Authorization`, `X-Scope-OrgID`. */
  readonly headers: Readonly<Record<string, string>>;
  /** Whether to check the server certificate. */
  readonly verifyTls: boolean;
}

/** Sends GET requests to Loki. */
export interface LokiApi {
  /**
   * Sends a GET request and reads its JSON answer.
   *
   * @param path - The API path, such as `/loki/api/v1/query_range`.
   * @param parameters - Query string parameters.
   * @param signal - Aborts the request.
   * @returns The answer.
   * @throws {ConnectorError} For an error answer, a timeout or a server that cannot be reached.
   */
  get<T>(
    path: string,
    parameters: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<T>;
}

/**
 * Removes quoted literals from a Loki message: they can be values from the query or the logs.
 *
 * @param message - The message.
 * @returns The message with every quoted literal replaced.
 */
export function redactLiterals(message: string): string {
  return message.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '"…"');
}

/**
 * Turns an error answer into a connector error. Loki answers errors in plain text.
 *
 * @param status - The HTTP status.
 * @param text - The body.
 * @returns The connector error.
 */
export function answerError(status: number, text: string): ConnectorError {
  const message = `Loki: ${text.trim()}`;
  if (status === 401) return new ConnectorError('authentication', 'Loki refused the credentials.');
  if (status === 403) return new ConnectorError('permission', 'Loki refused access.');
  if (/deadline exceeded|timeout|timed out/i.test(text) || status === 504)
    return new ConnectorError('timeout', 'The query ran longer than Loki allows.', message);
  if (status === 400 && /limit/i.test(text))
    return new ConnectorError('rejected', `Loki: ${redactLiterals(text.trim())}`, message);
  if (status === 400)
    return new ConnectorError('syntax', `Loki: ${redactLiterals(text.trim())}`, message);
  return new ConnectorError('internal', `Loki answered with HTTP ${status}.`, message);
}

/**
 * Creates the API client.
 *
 * @param options - The server URL, headers and TLS setting.
 * @returns The client.
 */
export function createLokiApi(options: ApiOptions): LokiApi {
  const client = createHttpClient({
    baseUrl: options.url,
    sourceName: 'Loki',
    headers: { Accept: 'application/json', ...options.headers },
    verifyTls: options.verifyTls,
  });
  return {
    async get<T>(path: string, parameters: Readonly<Record<string, string>>, signal: AbortSignal) {
      const response = await client.request({ path, query: parameters, signal });
      if (!response.ok) throw answerError(response.status, await response.text());
      return (await response.json()) as T;
    },
  };
}
