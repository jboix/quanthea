/** The API contract helper: each endpoint is declared once and both apps read it. */
import type { z } from 'zod';

/** Every endpoint path is served under this prefix. */
export const apiPrefix = '/api';

/** The HTTP methods an endpoint may use. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A schema slot of an endpoint: a Zod schema, or `undefined` when the endpoint takes no such input. */
type SchemaSlot = z.ZodType | undefined;

/**
 * One endpoint: method, path and the schemas for its inputs and output.
 *
 * @remarks `path` is relative to {@link apiPrefix} and uses `:name` segments for path parameters.
 */
export interface Endpoint<
  Params extends SchemaSlot = SchemaSlot,
  Query extends SchemaSlot = SchemaSlot,
  Body extends SchemaSlot = SchemaSlot,
  Output extends z.ZodType = z.ZodType,
> {
  /** The HTTP method. */
  readonly method: HttpMethod;
  /** The path under {@link apiPrefix}, such as `/threads/:threadId`. */
  readonly path: `/${string}`;
  /** Validates the path parameters. */
  readonly params: Params;
  /** Validates the query string. */
  readonly query: Query;
  /** Validates the JSON request body. */
  readonly body: Body;
  /** Validates the JSON response body. */
  readonly output: Output;
}

/** The fields accepted by {@link defineEndpoint}. Omitted input schemas mean "no such input". */
interface EndpointDefinition<
  Params extends SchemaSlot,
  Query extends SchemaSlot,
  Body extends SchemaSlot,
  Output extends z.ZodType,
> {
  /** The HTTP method. */
  readonly method: HttpMethod;
  /** The path under {@link apiPrefix}. */
  readonly path: `/${string}`;
  /** Validates the path parameters. */
  readonly params?: Params;
  /** Validates the query string. */
  readonly query?: Query;
  /** Validates the JSON request body. */
  readonly body?: Body;
  /** Validates the JSON response body. */
  readonly output: Output;
}

/** One input part as the caller sends it, present only when its schema slot holds a schema. */
type InputPart<Key extends string, Slot extends SchemaSlot> = Slot extends z.ZodType
  ? { readonly [Name in Key]: z.input<Slot> }
  : Record<never, never>;

/** One input part once its schema has parsed it, present only when its slot holds a schema. */
type ParsedPart<Key extends string, Slot extends SchemaSlot> = Slot extends z.ZodType
  ? { readonly [Name in Key]: z.output<Slot> }
  : Record<never, never>;

/** What a caller sends to an endpoint: `params`, `query` and `body`, each only when declared. */
export type EndpointInput<Target extends Endpoint> = InputPart<'params', Target['params']> &
  InputPart<'query', Target['query']> &
  InputPart<'body', Target['body']>;

/** What a handler receives once the server has parsed the request against the endpoint. */
export type ParsedEndpointInput<Target extends Endpoint> = ParsedPart<'params', Target['params']> &
  ParsedPart<'query', Target['query']> &
  ParsedPart<'body', Target['body']>;

/** What an endpoint returns once its output schema has parsed it. */
export type EndpointOutput<Target extends Endpoint> = z.output<Target['output']>;

/**
 * Declares an endpoint. The server mounts it and the web client calls it from the same object.
 *
 * @param definition - Method, path, output schema and the input schemas it takes.
 * @returns The endpoint, with an explicit `undefined` in each input slot left out.
 */
export function defineEndpoint<
  Output extends z.ZodType,
  Params extends SchemaSlot = undefined,
  Query extends SchemaSlot = undefined,
  Body extends SchemaSlot = undefined,
>(
  definition: EndpointDefinition<Params, Query, Body, Output>,
): Endpoint<Params, Query, Body, Output> {
  return {
    method: definition.method,
    path: definition.path,
    params: definition.params as Params,
    query: definition.query as Query,
    body: definition.body as Body,
    output: definition.output,
  };
}

/**
 * Fills the `:name` segments of an endpoint path with URL-encoded values.
 *
 * @param path - An endpoint path such as `/dashboards/:dashboardId`.
 * @param params - A value for every `:name` segment.
 * @returns The path with {@link apiPrefix} in front and every segment filled.
 * @throws {Error} When a `:name` segment has no value.
 */
export function buildPath(path: string, params: Readonly<Record<string, string>> = {}): string {
  const filled = path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_segment, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
  return `${apiPrefix}${filled}`;
}
