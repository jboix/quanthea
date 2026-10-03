/** Mounts a shared endpoint contract on the app: validate, authorize, handle, validate. */
import {
  apiPrefix,
  type Endpoint,
  type EndpointOutput,
  type ParsedEndpointInput,
  type Principal,
} from '@quanthea/shared';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import { AppError } from '../lib/errors.ts';
import { type Access, accessMiddleware } from './access.ts';
import type { AppEnv } from './app-env.ts';

/** What a route handler receives: the parsed input plus who is asking. */
export type EndpointRequest<Target extends Endpoint> = ParsedEndpointInput<Target> & {
  /** Who the request acts as, or `null` when it carries no valid session. */
  readonly principal: Principal | null;
  /** The request id, also sent back in the `X-Request-Id` header. */
  readonly requestId: string;
  /** Aborted when the client goes away. */
  readonly signal: AbortSignal;
};

/** How a route answers an endpoint. */
interface EndpointRoute<Target extends Endpoint> {
  /** Who may call it. Every route declares this. */
  readonly access: Access;
  /**
   * Handles a request whose input already passed the endpoint schemas.
   *
   * @param request - The parsed input and the principal.
   * @returns The response body. It is parsed with the output schema before it is sent.
   */
  handle(
    request: EndpointRequest<Target>,
  ): EndpointOutput<Target> | Promise<EndpointOutput<Target>>;
}

/** A validation problem, sent in `error.details`. */
interface InputIssue {
  /** Which part of the request failed. */
  readonly part: 'params' | 'query' | 'body';
  /** The dotted path inside that part. */
  readonly path: string;
  /** What is wrong. */
  readonly message: string;
}

/**
 * Parses one part of the request, collecting its issues instead of throwing.
 *
 * @param schema - The endpoint schema for this part, if it declares one.
 * @param part - The part name, used in the issues.
 * @param value - The raw value of this part.
 * @param issues - Receives any validation issues.
 * @returns The parsed value, or `undefined` when there is no schema or parsing failed.
 */
function parsePart(
  schema: z.ZodType | undefined,
  part: InputIssue['part'],
  value: unknown,
  issues: InputIssue[],
): unknown {
  if (!schema) return undefined;
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  issues.push(
    ...parsed.error.issues.map((issue) => ({
      part,
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
  return undefined;
}

/**
 * Reads the JSON body of a request that declares one.
 *
 * @param context - The request context.
 * @param endpoint - The endpoint being called.
 * @returns The decoded JSON, or `undefined` when the endpoint takes no body.
 * @throws {AppError} `bad_request` when the body is not valid JSON.
 */
async function readJsonBody(context: Context<AppEnv>, endpoint: Endpoint): Promise<unknown> {
  if (!endpoint.body) return undefined;
  try {
    return await context.req.json();
  } catch {
    throw new AppError('bad_request', 'The request body is not valid JSON.');
  }
}

/**
 * Parses the params, query and body of a request against an endpoint.
 *
 * @param context - The request context.
 * @param endpoint - The endpoint being called.
 * @returns The parsed input, shaped as the handler expects it.
 * @throws {AppError} `bad_request` listing every issue when any part is invalid.
 */
async function parseInput<Target extends Endpoint>(
  context: Context<AppEnv>,
  endpoint: Target,
): Promise<ParsedEndpointInput<Target>> {
  const issues: InputIssue[] = [];
  const body = await readJsonBody(context, endpoint);
  const input = {
    params: parsePart(endpoint.params, 'params', context.req.param(), issues),
    query: parsePart(endpoint.query, 'query', context.req.query(), issues),
    body: parsePart(endpoint.body, 'body', body, issues),
  };
  if (issues.length > 0) throw new AppError('bad_request', 'The request is invalid.', issues);
  // Every declared part passed its schema above; TypeScript cannot follow the conditional type.
  return input as unknown as ParsedEndpointInput<Target>;
}

/**
 * Mounts an endpoint at `/api` + its path. The route checks access first, then parses the input,
 * runs the handler, and parses the result with the output schema so only declared fields leave.
 *
 * @param app - The app to mount on.
 * @param endpoint - The shared endpoint contract.
 * @param route - The access declaration and the handler.
 */
export function mountEndpoint<Target extends Endpoint>(
  app: Hono<AppEnv>,
  endpoint: Target,
  route: EndpointRoute<Target>,
): void {
  app.on(
    endpoint.method,
    `${apiPrefix}${endpoint.path}`,
    accessMiddleware(route.access),
    async (context) => {
      const input = await parseInput(context, endpoint);
      const output = await route.handle({
        ...input,
        principal: context.get('principal'),
        requestId: context.get('requestId'),
        signal: context.req.raw.signal,
      });
      return context.json(endpoint.output.parse(output));
    },
  );
}

/** How a route answers an endpoint that streams: with a response of its own, not JSON. */
interface StreamRoute<Target extends Endpoint> {
  /** Who may call it. Every route declares this. */
  readonly access: Access;
  /**
   * Handles a request whose input already passed the endpoint schemas.
   *
   * @param request - The parsed input and the principal.
   * @returns The response, such as a UI message stream.
   */
  handle(request: EndpointRequest<Target>): Promise<Response>;
}

/**
 * Mounts an endpoint that streams its answer at `/api` + its path. The route checks access and
 * parses the input as {@link mountEndpoint} does; the handler's response goes out as it is.
 *
 * @param app - The app to mount on.
 * @param endpoint - The shared endpoint contract.
 * @param route - The access declaration and the handler.
 */
export function mountStreamEndpoint<Target extends Endpoint>(
  app: Hono<AppEnv>,
  endpoint: Target,
  route: StreamRoute<Target>,
): void {
  app.on(
    endpoint.method,
    `${apiPrefix}${endpoint.path}`,
    accessMiddleware(route.access),
    async (context) =>
      route.handle({
        ...(await parseInput(context, endpoint)),
        principal: context.get('principal'),
        requestId: context.get('requestId'),
        signal: context.req.raw.signal,
      }),
  );
}
