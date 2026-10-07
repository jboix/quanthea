/**
 * The HTTP JSON connector kind: any JSON API, read through the requests the admin allows. The base
 * URL is the only origin called; the methods (GET unless POST is allowed too) and the path patterns
 * bound what a query may ask; an OpenAPI description tells the agent the operations; the response
 * becomes a table through JSON pointers, never code.
 */
import type { Frame } from '@quanthea/shared';
import { z } from 'zod';
import {
  ConnectorError,
  type ConnectorInstance,
  createHttpClient,
  defineConnector,
  type ExecutionContext,
  type FieldReference,
  type HealthReport,
  type HttpClient,
  type HttpQuery,
  type HttpResponse,
} from '../_shared/index.ts';
import { responseFrame } from './extract.ts';
import { httpGuide } from './guide.ts';
import { jsonIcon } from './icon.ts';
import { type ApiDescription, type DescribedOperation, describeApi } from './openapi.ts';
import { type PathRules, pathRules, pathUnderBase } from './paths.ts';

/** The configuration of an HTTP JSON connector. */
const configSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).meta({
    title: 'Base URL',
    description: 'The only origin the connector calls. Its path prefixes every request.',
    examples: ['https://status.internal/api'],
  }),
  methods: z.enum(['GET', 'GET and POST']).default('GET').meta({
    title: 'Methods',
    description: 'Allow POST for an API that takes its queries in a body.',
  }),
  paths: z
    .string()
    .trim()
    .default('/**')
    .meta({
      title: 'Allowed paths',
      description: '* matches within a segment, ** across segments. Commas between patterns.',
      examples: ['/v1/**'],
    }),
  openapi: z
    .string()
    .trim()
    .optional()
    .meta({
      title: 'OpenAPI description',
      description: 'Its path under the base URL, JSON or YAML. It tells the agent the operations.',
      examples: ['/openapi.json'],
    }),
  auth: z
    .enum(['none', 'bearer', 'basic', 'header'])
    .default('none')
    .meta({ title: 'Authentication' }),
  username: z
    .string()
    .trim()
    .optional()
    .meta({ title: 'Username', description: 'For basic authentication.' }),
  headerName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]+$/, 'A header name is letters, digits and dashes.')
    .optional()
    .meta({ title: 'Key header', description: 'For a key in a header.', examples: ['X-API-Key'] }),
  verifyTls: z.boolean().default(true).meta({ title: 'Verify the TLS certificate' }),
});

/** The credentials of an HTTP JSON connector. */
const secretSchema = z.object({
  token: z
    .string()
    .optional()
    .meta({ title: 'Bearer token', description: 'For bearer authentication.' }),
  password: z
    .string()
    .optional()
    .meta({ title: 'Password', description: 'For basic authentication.' }),
  apiKey: z.string().optional().meta({ title: 'Key', description: 'Sent in the key header.' }),
});

/** A connector's configuration. */
type Config = z.output<typeof configSchema>;

/** What an open connector holds. */
interface Connection {
  /** The HTTP client, with the credentials. */
  readonly client: HttpClient;
  /** The methods allowed. */
  readonly methods: readonly HttpQuery['method'][];
  /** The paths allowed. */
  readonly paths: PathRules;
  /** The operations of the description, read once a while; empty without a description. */
  readonly operations: (signal: AbortSignal) => Promise<ReadonlyMap<string, DescribedOperation>>;
  /** The configuration. */
  readonly config: Config;
}

/** How long a read description is reused, in milliseconds. */
const descriptionTtlMs = 5 * 60_000;

/** The most bytes of an OpenAPI description read. */
const descriptionMaxBytes = 5 * 1024 * 1024;

/** How long health checks and description reads may take, in milliseconds. */
const metadataTimeoutMs = 30_000;

/**
 * The header of a key.
 *
 * @param name - The header name, if set.
 * @param key - The key, if set.
 * @returns The header, or the reason it is incomplete.
 */
function keyHeader(
  name: string | undefined,
  key: string | undefined,
): Record<string, string> | string {
  return name && key ? { [name]: key } : 'Set the key header and the key.';
}

/**
 * The headers of the configured authentication.
 *
 * @param config - The configuration.
 * @param secret - The credentials.
 * @returns The headers, or the reason the credentials are incomplete.
 */
function authHeaders(
  config: Config,
  secret: z.output<typeof secretSchema>,
): Record<string, string> | string {
  if (config.auth === 'none') return {};
  if (config.auth === 'bearer')
    return secret.token ? { Authorization: `Bearer ${secret.token}` } : 'Set the bearer token.';
  if (config.auth === 'header') return keyHeader(config.headerName, secret.apiKey);
  if (!config.username || secret.password === undefined)
    return 'Basic authentication needs a username and a password.';
  return {
    Authorization: `Basic ${Buffer.from(`${config.username}:${secret.password}`).toString('base64')}`,
  };
}

/**
 * The error a failed response carries. The body may quote data, so only people allowed to see the
 * data get it.
 *
 * @param response - The response, whose status is not 2xx.
 * @returns The connector error.
 */
async function statusError(response: HttpResponse): Promise<ConnectorError> {
  const body = (await response.text().catch(() => '')).slice(0, 500);
  const status = response.status;
  const message = `HTTP ${status}: ${body}`;
  if (status === 401)
    return new ConnectorError('authentication', 'The API refused the credentials.', message);
  if (status === 403) return new ConnectorError('permission', 'The API refused access.', message);
  if (status === 404)
    return new ConnectorError('not_found', 'The API has no such path (HTTP 404).', message);
  if (status === 429)
    return new ConnectorError('rejected', 'The API is limiting requests (HTTP 429).', message);
  if (status < 500)
    return new ConnectorError('syntax', `The API refused the request (HTTP ${status}).`, message);
  return new ConnectorError('internal', `The API failed (HTTP ${status}).`, message);
}

/**
 * The query parameters as the client takes them: a repeated name becomes a list.
 *
 * @param pairs - The parameters, in order.
 * @returns The parameters by name.
 */
function queryOf(pairs: HttpQuery['query']): Record<string, string[]> {
  const query: Record<string, string[]> = {};
  for (const [name, value] of pairs) query[name] = [...(query[name] ?? []), value];
  return query;
}

/**
 * Sends a bound request and turns its JSON answer into a table.
 *
 * @param connection - The connection.
 * @param query - The bound query.
 * @param context - The execution context.
 * @returns One frame.
 * @throws {ConnectorError} `rejected` for a method or path the connector does not allow, and any
 *   failure of the request or its answer.
 */
async function execute(
  connection: Connection,
  query: HttpQuery,
  context: ExecutionContext,
): Promise<Frame[]> {
  if (!connection.methods.includes(query.method))
    throw new ConnectorError(
      'rejected',
      `This connector allows ${connection.config.methods} only.`,
    );
  const reached = pathUnderBase(connection.config.url, query.path);
  if (reached === undefined || !connection.paths.allows(reached))
    throw new ConnectorError('rejected', 'The path is not one this connector allows.');
  const started = performance.now();
  const post = query.method === 'POST';
  const response = await connection.client.request({
    method: query.method,
    path: query.path,
    query: queryOf(query.query),
    ...(post
      ? { body: JSON.stringify(query.body ?? {}), headers: { 'Content-Type': 'application/json' } }
      : {}),
    signal: context.signal,
  });
  if (!response.ok) throw await statusError(response);
  const document = await response.json();
  return [responseFrame(document, query.extract, context, performance.now() - started)];
}

/**
 * Reads and parses the OpenAPI description, JSON or YAML.
 *
 * @param client - The HTTP client.
 * @param path - Its path under the base URL.
 * @param signal - The caller's signal.
 * @returns The description.
 * @throws {ConnectorError} When it cannot be read or parsed.
 */
async function readDescription(
  client: HttpClient,
  path: string,
  signal: AbortSignal,
): Promise<ApiDescription> {
  const response = await client.request({ path: path.startsWith('/') ? path : `/${path}`, signal });
  if (!response.ok) throw await statusError(response);
  const text = await response.text();
  try {
    return (
      text.trimStart().startsWith('{') ? JSON.parse(text) : Bun.YAML.parse(text)
    ) as ApiDescription;
  } catch {
    throw new ConnectorError('internal', 'The OpenAPI description is neither JSON nor YAML.');
  }
}

/**
 * Creates the reader of the operations: the description read once a while.
 *
 * @param client - The HTTP client.
 * @param config - The configuration.
 * @param paths - The paths allowed.
 * @returns The reader.
 */
function operationsReader(
  client: HttpClient,
  config: Config,
  paths: PathRules,
): Connection['operations'] {
  let cached:
    | { readonly at: number; readonly operations: Promise<Map<string, DescribedOperation>> }
    | undefined;
  const methods = config.methods === 'GET' ? ['get'] : ['get', 'post'];
  return (signal) => {
    if (config.openapi === undefined || config.openapi === '') return Promise.resolve(new Map());
    if (cached && Date.now() - cached.at < descriptionTtlMs) return cached.operations;
    const operations = readDescription(client, config.openapi, signal).then((document) =>
      describeApi(document, methods, paths),
    );
    cached = { at: Date.now(), operations };
    operations.catch(() => {
      cached = undefined;
    });
    return operations;
  };
}

/**
 * Checks that the API answers: its description when there is one, else its base path, whatever
 * the status. Whether the credentials could change anything is the API's to say, so the report
 * does not.
 *
 * @param connection - The connection.
 * @param signal - The caller's signal.
 * @returns The health report.
 */
async function test(connection: Connection, signal: AbortSignal): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)]);
  try {
    if (connection.config.openapi) {
      const operations = await connection.operations(bounded);
      const message = `The OpenAPI description lists ${operations.size} operations the connector allows.`;
      return { ok: true, latencyMs: latencyMs(), message, readOnly: null };
    }
    const response = await connection.client.request({ path: '/', signal: bounded });
    await response.cancel();
    const message = `The API answers (HTTP ${response.status}). Without an OpenAPI description the agent learns it by trying.`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly: null };
  } catch (error) {
    const message = error instanceof ConnectorError ? error.safeMessage : 'The test failed.';
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}

/**
 * Reads the values the description lists for a field or a parameter of an operation.
 *
 * @param connection - The connection.
 * @param field - The operation and the field.
 * @param limit - How many values at most.
 * @param signal - The caller's signal.
 * @returns The values and whether there are more.
 * @throws {ConnectorError} `not_found` when the description lists none.
 */
async function sampleValues(
  connection: Connection,
  field: FieldReference,
  limit: number,
  signal: AbortSignal,
) {
  const operations = await connection.operations(
    AbortSignal.any([signal, AbortSignal.timeout(metadataTimeoutMs)]),
  );
  const listed = operations.get(field.entity)?.values.get(field.field);
  if (!listed)
    throw new ConnectorError(
      'not_found',
      `The description lists no values for "${field.entity}" ${field.field}.`,
    );
  return { values: listed.slice(0, limit), complete: listed.length <= limit };
}

/**
 * A connection whose settings are incomplete: every call says so.
 *
 * @param reason - What is missing.
 * @returns The connection.
 */
function misconfigured(reason: string): ConnectorInstance {
  const error = () => Promise.reject(new ConnectorError('authentication', reason));
  return {
    test: () => Promise.resolve({ ok: false, latencyMs: 0, message: reason, readOnly: null }),
    describe: error,
    sampleValues: error,
    execute: error,
    close: () => Promise.resolve(),
  };
}

/**
 * A URL without the user name and password it may carry.
 *
 * @param url - The URL.
 * @returns The URL without credentials.
 */
function withoutCredentials(url: string): string {
  const parsed = new URL(url);
  parsed.username = '';
  parsed.password = '';
  return parsed.href;
}

/**
 * Opens a connection: the client with the credentials, and the rules of the settings. The
 * description is read through a client of its own, with a smaller byte cap.
 *
 * @param config - The configuration.
 * @param headers - The authentication headers.
 * @returns The connection.
 */
function connect(config: Config, headers: Readonly<Record<string, string>>): Connection {
  const options = {
    baseUrl: config.url,
    sourceName: 'The API',
    headers: { Accept: 'application/json', ...headers },
    verifyTls: config.verifyTls,
  };
  const client = createHttpClient(options);
  const describer = createHttpClient({ ...options, maxBytes: descriptionMaxBytes });
  const paths = pathRules(config.paths);
  const methods: HttpQuery['method'][] = config.methods === 'GET' ? ['GET'] : ['GET', 'POST'];
  return { client, methods, paths, operations: operationsReader(describer, config, paths), config };
}

/** The HTTP JSON connector kind. */
export const httpConnector = defineConnector({
  kind: 'http',
  displayName: 'HTTP JSON',
  icon: jsonIcon,
  aliases: ['rest', 'api', 'openapi', 'swagger', 'json'],
  language: 'http',
  queryGuide: httpGuide,
  configSchema,
  secretSchema,
  describeTarget: (config) => withoutCredentials(config.url),
  open({ config, secret }): ConnectorInstance {
    const headers = authHeaders(config, secret);
    if (typeof headers === 'string') return misconfigured(headers);
    const connection = connect(config, headers);
    return {
      test: (signal) => test(connection, signal),
      describe: async (signal) => ({
        entities: [...(await connection.operations(signal)).values()].map(
          (operation) => operation.entity,
        ),
      }),
      sampleValues: (field, limit, signal) => sampleValues(connection, field, limit, signal),
      execute: (query, context) =>
        query.language === 'http'
          ? execute(connection, query, context)
          : Promise.reject(
              new ConnectorError('rejected', 'This connector runs HTTP requests only.'),
            ),
      close: () => Promise.resolve(),
    };
  },
});
