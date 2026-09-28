/** Logs one line per request, once the response is known. */
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Logger } from '../lib/logger.ts';
import type { AppEnv } from './app-env.ts';

/**
 * Creates the request logging middleware.
 *
 * @param logger - Receives one `info` line per request.
 * @returns The middleware.
 */
export function logRequests(logger: Logger): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (context, next) => {
    const startedAt = performance.now();
    await next();
    logger.info('request', {
      requestId: context.get('requestId'),
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  });
}
