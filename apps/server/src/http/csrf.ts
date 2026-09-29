/**
 * Cross-site request forgery: a request that changes something must come from querent's own
 * pages. Such a request carries `X-Requested-With: querent`, which a cross-site form or image
 * cannot send without a CORS preflight querent never grants; when the browser names the request's
 * origin, it must be querent's. The session cookie is also SameSite=Lax.
 */
import { apiPrefix } from '@querent/shared';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { AppError } from '../lib/errors.ts';
import type { AppEnv } from './app-env.ts';

/** Methods that read only. */
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Whether a request may change something, from what the browser says about where it comes from.
 *
 * @param request - The request.
 * @param allowedOrigin - querent's origin.
 * @returns Why not, or `undefined` when it may.
 */
export function crossSiteRefusal(request: Request, allowedOrigin: string): string | undefined {
  if (request.headers.get('x-requested-with') !== 'querent')
    return 'This request must come from querent’s own pages.';
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== allowedOrigin) return 'This request comes from another site.';
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none')
    return 'This request comes from another site.';
  return undefined;
}

/**
 * Refuses a changing `/api` request that does not come from querent's own pages.
 *
 * @param publicUrl - querent's origin, when configured; else the origin the request was sent to.
 * @returns The middleware. It answers 403.
 */
export function refuseCrossSite(publicUrl: string | undefined): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (context, next) => {
    const { raw } = context.req;
    if (!safeMethods.has(raw.method) && context.req.path.startsWith(`${apiPrefix}/`)) {
      const refusal = crossSiteRefusal(raw, publicUrl ?? new URL(raw.url).origin);
      if (refusal) throw new AppError('forbidden', refusal);
    }
    await next();
  });
}
