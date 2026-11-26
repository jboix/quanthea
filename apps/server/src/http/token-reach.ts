/**
 * What an API token reaches: the MCP endpoint, and nothing else. The rest of the API answers a
 * person's browser with data as they see it, outside the connectors' access levels. A token may be
 * held by a model, so it reads only where every result comes out of the gate. It also follows that
 * a leaked token cannot make another token, change a user or change how people sign in.
 */
import { apiPrefix, mcpPath } from '@quanthea/shared';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { apiTokenOf } from '../auth/bearer.ts';
import { AppError } from '../lib/errors.ts';
import type { AppEnv } from './app-env.ts';

/** The one path a token reaches. */
const openToTokens = `${apiPrefix}${mcpPath}`;

/**
 * Whether a path is one an API token reaches.
 *
 * @param path - The request's path.
 * @returns Whether it is the MCP endpoint.
 */
export function isOpenToTokens(path: string): boolean {
  return path === openToTokens;
}

/**
 * Refuses a request that carries an API token anywhere but on the MCP endpoint.
 *
 * @returns The middleware. It answers 403.
 */
export function refuseTokensOutsideMcp(): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (context, next) => {
    if (apiTokenOf(context.req.raw) !== undefined && !isOpenToTokens(context.req.path))
      throw new AppError(
        'forbidden',
        `An MCP token works on the MCP endpoint only, at ${openToTokens}.`,
      );
    await next();
  });
}
