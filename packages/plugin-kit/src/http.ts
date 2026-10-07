/**
 * The HTTP client of every connector kind that speaks HTTP. It calls one origin only, follows a
 * redirect only within it, never calls a cloud metadata address, stops at a timeout and reads at
 * most a set number of bytes.
 */
import { ConnectorError } from './errors.ts';
import { checkDestination } from './http-address.ts';

/** How a client reaches its source. */
export interface HttpClientOptions {
  /** The base URL. Its origin is the only one called; its path prefixes every request path. */
  readonly baseUrl: string;
  /** The source, in error messages, such as `ClickHouse`. */
  readonly sourceName: string;
  /** Headers sent with every request, such as `Authorization`. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Whether to check the server certificate. Defaults to `true`. */
  readonly verifyTls?: boolean;
  /** The longest a request may take, body included, in milliseconds. Defaults to 120 seconds. */
  readonly timeoutMs?: number;
  /** The most bytes of a body read. Defaults to 64 MiB. */
  readonly maxBytes?: number;
}

/** The methods a connector sends. */
type HttpMethod = 'GET' | 'POST' | 'DELETE';

/** One request. */
export interface HttpRequest {
  /** The method. Defaults to `GET`. */
  readonly method?: HttpMethod;
  /**
   * The path under the base URL, starting with `/`, or an absolute URL on the same origin, such as
   * a link to the next page the source returned.
   */
  readonly path: string;
  /** Query string parameters; an array value repeats the parameter. */
  readonly query?: Readonly<Record<string, string | readonly string[]>>;
  /** Headers for this request, added to the client's. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The body of a POST. */
  readonly body?: string;
  /** Aborts the request and the reading of its body. */
  readonly signal: AbortSignal;
}

/** A response whose body is read at most once, within the byte cap. */
export interface HttpResponse {
  /** The HTTP status. */
  readonly status: number;
  /** Whether the status is 2xx. */
  readonly ok: boolean;
  /** The response headers. */
  readonly headers: Headers;
  /**
   * Reads the body as text.
   *
   * @returns The text.
   * @throws {ConnectorError} Past the byte cap, at the timeout or when the connection fails.
   */
  text(): Promise<string>;
  /**
   * Reads the body as JSON.
   *
   * @returns The parsed value.
   * @throws {ConnectorError} When the body is not JSON, and as {@link HttpResponse.text}.
   */
  json(): Promise<unknown>;
  /**
   * Reads the body line by line, without the line ends. Stopping early closes the connection.
   *
   * @returns The lines.
   * @throws {ConnectorError} As {@link HttpResponse.text}.
   */
  lines(): AsyncGenerator<string>;
  /**
   * Leaves the body unread and closes the connection.
   *
   * @returns Once the body is cancelled.
   */
  cancel(): Promise<void>;
}

/** Sends requests to one source. */
export interface HttpClient {
  /**
   * Sends a request.
   *
   * @param request - The request.
   * @returns The response, whatever its status.
   * @throws {ConnectorError} `unreachable` when the connection fails, `timeout` when the signal or
   *   the timeout fires, `rejected` for a redirect to another origin or a metadata address.
   */
  request(request: HttpRequest): Promise<HttpResponse>;
}

/** Redirects followed at most within the origin. */
const maxRedirects = 5;

/** What a client uses of its options, with the defaults applied. */
interface ClientSettings {
  /** The base URL, without a trailing slash. */
  readonly base: string;
  /** The path of the base URL, without a trailing slash: every relative request stays under it. */
  readonly basePath: string;
  /** The only origin called. */
  readonly origin: string;
  /** The source, for messages. */
  readonly sourceName: string;
  /** The headers of every request. */
  readonly headers: Readonly<Record<string, string>>;
  /** Whether to check the server certificate. */
  readonly verifyTls: boolean;
  /** The timeout, in milliseconds. */
  readonly timeoutMs: number;
  /** The byte cap. */
  readonly maxBytes: number;
}

/**
 * Turns a failed fetch or body read into a connector error.
 *
 * @param error - What was thrown.
 * @param signal - The request's signal, timeout included.
 * @param sourceName - The source, for the message.
 * @returns The connector error.
 */
function transportError(error: unknown, signal: AbortSignal, sourceName: string): ConnectorError {
  if (error instanceof ConnectorError) return error;
  if (signal.aborted) {
    return new ConnectorError(
      'timeout',
      'The query was cancelled: it ran longer than the timeout, or the caller gave up.',
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ConnectorError('unreachable', `${sourceName} cannot be reached.`, message, {
    cause: error,
  });
}

/**
 * Whether a URL's path, dot segments resolved, is the base path or under it.
 *
 * @param url - The parsed URL.
 * @param basePath - The base path, without a trailing slash.
 * @returns `true` when the path stays under the base path.
 */
function isUnderBase(url: URL, basePath: string): boolean {
  return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
}

/**
 * Builds a request URL under the base URL. A relative path is parsed first, so `.` and `..`
 * segments (`%2e` included) are resolved before its place is checked.
 *
 * @param settings - The client settings.
 * @param request - The request.
 * @returns The URL.
 * @throws {ConnectorError} `rejected` when an absolute URL leaves the origin, or a relative path
 *   leaves the base path.
 */
function requestUrl(settings: ClientSettings, request: HttpRequest): URL {
  const absolute = /^https?:\/\//i.test(request.path);
  const url = new URL(absolute ? request.path : `${settings.base}${request.path}`);
  if (url.origin !== settings.origin)
    throw new ConnectorError('rejected', `A request left the ${settings.sourceName} origin.`);
  if (!absolute && !isUnderBase(url, settings.basePath))
    throw new ConnectorError('rejected', `A request left the ${settings.sourceName} base path.`);
  const parameters = Object.entries(request.query ?? {}).flatMap(([name, value]) =>
    (typeof value === 'string' ? [value] : value).map((item) => [name, item] as const),
  );
  for (const [name, item] of parameters) url.searchParams.append(name, item);
  return url;
}

/**
 * Reads a body in chunks, within the byte cap. Stopping early cancels the body, which closes the
 * connection.
 *
 * @param body - The body.
 * @param settings - The client settings.
 * @param signal - The request's signal.
 * @returns The chunks.
 */
async function* chunksOf(
  body: ReadableStream<Uint8Array> | null,
  settings: ClientSettings,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  let total = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      total += chunk.value.byteLength;
      if (total > settings.maxBytes) throw tooLarge(settings);
      yield chunk.value;
    }
  } catch (error) {
    throw transportError(error, signal, settings.sourceName);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * The error for a body past the byte cap.
 *
 * @param settings - The client settings.
 * @returns The error.
 */
function tooLarge(settings: ClientSettings): ConnectorError {
  const mebibytes = Math.round(settings.maxBytes / 1024 / 1024);
  return new ConnectorError(
    'rejected',
    `${settings.sourceName} sent more than ${mebibytes} MiB. Ask for fewer rows or a shorter range.`,
  );
}

/**
 * Splits chunks of UTF-8 into lines, without the `\n` or `\r\n` that ends them.
 *
 * @param chunks - The chunks.
 * @returns The lines, the last one also when it has no line end.
 */
async function* linesOf(chunks: AsyncGenerator<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of chunks) {
    const parts = (pending + decoder.decode(chunk, { stream: true })).split('\n');
    pending = parts.pop() ?? '';
    for (const line of parts) yield line.replace(/\r$/, '');
  }
  pending += decoder.decode();
  if (pending !== '') yield pending.replace(/\r$/, '');
}

/**
 * Wraps a fetch response so its body is read within the byte cap.
 *
 * @param response - The fetch response.
 * @param settings - The client settings.
 * @param signal - The request's signal.
 * @returns The response.
 */
function wrapResponse(
  response: Response,
  settings: ClientSettings,
  signal: AbortSignal,
): HttpResponse {
  const text = async (): Promise<string> => {
    const decoder = new TextDecoder();
    let result = '';
    for await (const chunk of chunksOf(response.body, settings, signal))
      result += decoder.decode(chunk, { stream: true });
    return result + decoder.decode();
  };
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    text,
    json: async () => {
      const body = await text();
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new ConnectorError('internal', `${settings.sourceName} did not answer with JSON.`);
      }
    },
    lines: () => linesOf(chunksOf(response.body, settings, signal)),
    cancel: async () => {
      await response.body?.cancel().catch(() => undefined);
    },
  };
}

/**
 * Where a redirect goes, when it stays within the origin.
 *
 * @param response - The response.
 * @param url - The URL that answered.
 * @param settings - The client settings.
 * @returns The next URL, or `undefined` when the response is not a redirect.
 * @throws {ConnectorError} `rejected` for a redirect to another origin.
 */
function redirectTarget(response: Response, url: URL, settings: ClientSettings): URL | undefined {
  const location = response.headers.get('location');
  if (response.status < 300 || response.status > 399 || location === null) return undefined;
  const target = new URL(location, url);
  if (target.origin === settings.origin) return target;
  throw new ConnectorError(
    'rejected',
    `${settings.sourceName} redirected to another origin, which connectors never follow.`,
  );
}

/**
 * Sends one request, without following a redirect.
 *
 * @param url - The URL.
 * @param method - The method.
 * @param settings - The client settings.
 * @param request - The request, for its headers and body.
 * @param signal - The request's signal, timeout included.
 * @returns The fetch response.
 */
function fetchOnce(
  url: URL,
  method: HttpMethod,
  settings: ClientSettings,
  request: HttpRequest,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: { ...settings.headers, ...request.headers },
    ...(method === 'POST' ? { body: request.body } : {}),
    redirect: 'manual',
    signal,
    tls: { rejectUnauthorized: settings.verifyTls },
  });
}

/**
 * Sends a request, following redirects within the origin. A 307 or 308 keeps the method and
 * body; any other redirect continues with a GET.
 *
 * @param settings - The client settings.
 * @param request - The request.
 * @param signal - The request's signal, timeout included.
 * @returns The final fetch response.
 */
async function send(
  settings: ClientSettings,
  request: HttpRequest,
  signal: AbortSignal,
): Promise<Response> {
  let url = requestUrl(settings, request);
  await checkDestination(url, settings.sourceName);
  let method: HttpMethod = request.method ?? 'GET';
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchOnce(url, method, settings, request, signal);
    const target = redirectTarget(response, url, settings);
    if (target === undefined || redirects === maxRedirects) return response;
    await response.body?.cancel();
    if (response.status !== 307 && response.status !== 308) method = 'GET';
    url = target;
  }
}

/**
 * Creates a client for one source.
 *
 * @param options - The base URL, headers, TLS setting and limits.
 * @returns The client.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const base = new URL(options.baseUrl);
  const settings: ClientSettings = {
    base: base.href.replace(/\/+$/, ''),
    basePath: base.pathname.replace(/\/+$/, ''),
    origin: base.origin,
    sourceName: options.sourceName,
    headers: options.headers ?? {},
    verifyTls: options.verifyTls ?? true,
    timeoutMs: options.timeoutMs ?? 120_000,
    maxBytes: options.maxBytes ?? 64 * 1024 * 1024,
  };
  return {
    async request(request) {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(settings.timeoutMs)]);
      try {
        return wrapResponse(await send(settings, request, signal), settings, signal);
      } catch (error) {
        throw transportError(error, signal, settings.sourceName);
      }
    },
  };
}
