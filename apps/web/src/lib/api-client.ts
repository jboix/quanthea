/** The typed API client: calls endpoints declared in `@quanthea/shared` and validates the answers. */
import {
  type ApiErrorCode,
  apiErrorBodySchema,
  buildPath,
  type Endpoint,
  type EndpointInput,
  type EndpointOutput,
} from '@quanthea/shared';

/** An error answer from the API, or a response the client could not understand. */
export class ApiError extends Error {
  /** The stable error code to switch on. */
  readonly code: ApiErrorCode;
  /** The HTTP status. */
  readonly status: number;
  /** Structured context sent by the server, such as validation issues. */
  readonly details: unknown;

  /**
   * Creates the error.
   *
   * @param code - The stable error code.
   * @param status - The HTTP status.
   * @param message - The message from the server.
   * @param details - Structured context from the server.
   */
  constructor(code: ApiErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** The `fetch` the client sends requests with. */
type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

/** Options of one call. */
interface CallOptions {
  /** Cancels the request when it fires. */
  readonly signal?: AbortSignal | undefined;
}

/** The input argument: optional when the endpoint declares no params, query or body. */
type CallArguments<Target extends Endpoint> =
  Record<never, never> extends EndpointInput<Target>
    ? [input?: EndpointInput<Target>, options?: CallOptions]
    : [input: EndpointInput<Target>, options?: CallOptions];

/** Calls API endpoints. */
export interface ApiClient {
  /**
   * Calls an endpoint.
   *
   * @param endpoint - The endpoint contract.
   * @param input - Its params, query and body, when it declares them, and the call options.
   * @returns The response body, parsed with the endpoint's output schema.
   * @throws {ApiError} When the server answers with an error, or with a body that does not parse.
   */
  call<Target extends Endpoint>(
    endpoint: Target,
    ...input: CallArguments<Target>
  ): Promise<EndpointOutput<Target>>;
}

/** The parts of an endpoint input, read without knowing which ones the endpoint declares. */
interface LooseInput {
  /** Path parameters. */
  readonly params?: Readonly<Record<string, string>>;
  /** Query string values. */
  readonly query?: Readonly<Record<string, unknown>>;
  /** The JSON body. */
  readonly body?: unknown;
}

/**
 * Builds the request URL: the filled path plus a query string for the defined query values.
 *
 * @param endpoint - The endpoint contract.
 * @param input - The call input.
 * @returns A same-origin URL.
 */
function requestUrl(endpoint: Endpoint, input: LooseInput): string {
  const path = buildPath(endpoint.path, input.params);
  const query = new URLSearchParams(
    Object.entries(input.query ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, String(value)]),
  ).toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Builds the request options. Every request says it comes from the app, for the server's CSRF check.
 *
 * @param endpoint - The endpoint contract.
 * @param input - The call input.
 * @param options - The call options.
 * @returns The options for `fetch`.
 */
function requestInit(endpoint: Endpoint, input: LooseInput, options: CallOptions): RequestInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'querent',
  };
  const signal = options.signal ? { signal: options.signal } : {};
  if (endpoint.body === undefined) return { method: endpoint.method, headers, ...signal };
  headers['Content-Type'] = 'application/json';
  return { method: endpoint.method, headers, body: JSON.stringify(input.body), ...signal };
}

/**
 * Turns an error response into an {@link ApiError}.
 *
 * @param response - A response with a non-2xx status.
 * @returns The error, with the server's code when the body has the error shape.
 */
async function toApiError(response: Response): Promise<ApiError> {
  const parsed = apiErrorBodySchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    return new ApiError('internal', response.status, `Unexpected ${response.status} response.`);
  }
  const { code, message, details } = parsed.data.error;
  return new ApiError(code, response.status, message, details);
}

/**
 * Creates an API client.
 *
 * @param fetchFunction - Sends the requests. Defaults to the global `fetch`.
 * @returns The client.
 */
export function createApiClient(
  fetchFunction: FetchFunction = (url, init) => fetch(url, init),
): ApiClient {
  return {
    async call(endpoint, ...[input = {}, options = {}]) {
      const loose = input as LooseInput;
      const response = await fetchFunction(
        requestUrl(endpoint, loose),
        requestInit(endpoint, loose, options),
      );
      if (!response.ok) throw await toApiError(response);
      const parsed = endpoint.output.safeParse(await response.json());
      if (!parsed.success) {
        throw new ApiError(
          'internal',
          response.status,
          'The response does not match the contract.',
        );
      }
      return parsed.data as EndpointOutput<typeof endpoint>;
    },
  };
}
