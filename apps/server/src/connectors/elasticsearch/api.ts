/**
 * Requests to Elasticsearch and OpenSearch over the kit's HTTP client: JSON in and out, error
 * answers turned into connector errors, and which of the two servers answers, read once.
 */
import { createHttpClient, type HttpClient } from '../_shared/index.ts';
import { type ServerError, toConnectorError } from './errors.ts';

/** How to reach a server. */
export interface ApiOptions {
  /** The base URL, such as `https://search.internal:9200`. */
  readonly url: string;
  /** Headers sent with every request, such as `Authorization`. */
  readonly headers: Readonly<Record<string, string>>;
  /** Whether to check the server certificate. */
  readonly verifyTls: boolean;
}

/** Which server answers. */
export interface ServerInfo {
  /** `Elasticsearch` or `OpenSearch`. */
  readonly product: 'Elasticsearch' | 'OpenSearch';
  /** The version, such as `9.5.3`. */
  readonly version: string;
}

/** One request. */
export interface ApiRequest {
  /** `GET`, or `POST` for a body. */
  readonly method?: 'GET' | 'POST';
  /** The path, such as `/logs/_search`. */
  readonly path: string;
  /** Query string parameters. */
  readonly query?: Readonly<Record<string, string>>;
  /** The JSON body. */
  readonly body?: unknown;
  /** Aborts the request. */
  readonly signal: AbortSignal;
}

/** Sends requests to one server. */
export interface SearchApi {
  /**
   * Sends a request and reads its JSON answer.
   *
   * @param request - The request.
   * @returns The answer.
   * @throws {ConnectorError} For an error answer, a timeout or a server that cannot be reached.
   */
  request<T>(request: ApiRequest): Promise<T>;
  /**
   * Reads which server answers, once: later calls reuse the answer.
   *
   * @param signal - Aborts the first request.
   * @returns The product and version.
   */
  server(signal: AbortSignal): Promise<ServerInfo>;
}

/** The name the server's errors carry before it is known. */
const sourceName = 'The search server';

/** The root answer, as far as it tells the server. */
interface RootAnswer {
  /** The version. */
  readonly version?: { readonly number?: string; readonly distribution?: string };
}

/**
 * Sends a request and reads its JSON answer.
 *
 * @param client - The HTTP client.
 * @param request - The request.
 * @returns The answer.
 */
async function send<T>(client: HttpClient, request: ApiRequest): Promise<T> {
  const response = await client.request({
    method: request.method ?? 'GET',
    path: request.path,
    ...(request.query ? { query: request.query } : {}),
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    signal: request.signal,
  });
  const answer = (await response.json().catch(() => undefined)) as
    | { readonly error?: ServerError | string }
    | undefined;
  if (response.ok && answer !== undefined) return answer as T;
  const error = typeof answer?.error === 'object' ? answer.error : undefined;
  throw toConnectorError(response.status, error, sourceName);
}

/**
 * Creates the API of one server.
 *
 * @param options - The URL, headers and TLS setting.
 * @returns The API.
 */
export function createSearchApi(options: ApiOptions): SearchApi {
  const client = createHttpClient({
    baseUrl: options.url,
    sourceName,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...options.headers },
    verifyTls: options.verifyTls,
  });
  let info: Promise<ServerInfo> | undefined;
  const readInfo = async (signal: AbortSignal): Promise<ServerInfo> => {
    const root = await send<RootAnswer>(client, { path: '/', signal });
    const product = root.version?.distribution === 'opensearch' ? 'OpenSearch' : 'Elasticsearch';
    return { product, version: root.version?.number ?? '?' };
  };
  return {
    request: (request) => send(client, request),
    server(signal) {
      info ??= readInfo(signal).catch((error: unknown) => {
        info = undefined;
        throw error;
      });
      return info;
    },
  };
}
