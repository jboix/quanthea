/**
 * Sets the request's principal on the context. Authorization happens per route. A request that
 * carries an API token is judged by the token alone, so its cookie is never read. An address that
 * keeps sending tokens that sign nobody in must wait (`auth/throttle.ts`).
 */
import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Authenticator } from '../auth/authenticator.ts';
import { apiTokenOf } from '../auth/bearer.ts';
import type { Throttle } from '../auth/throttle.ts';
import type { SignInWithToken } from '../auth/token-sign-in.ts';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import type { AppEnv } from './app-env.ts';
import { clientAddress } from './client-address.ts';

/** What signing requests in with an API token needs. */
export interface TokenAuthentication {
  /** Signs a token in. */
  readonly signIn: SignInWithToken;
  /** Throttles the addresses whose tokens sign nobody in. */
  readonly failures: Throttle;
  /** How many proxies in front of quanthea append to `X-Forwarded-For`. */
  readonly trustedProxyHops: number;
  /** Where a refused token is logged. */
  readonly logger: Pick<Logger, 'warn'>;
}

/**
 * Signs a request in with its token, and sets the principal and the token on the context. The
 * failure is counted before the check and taken back after a success, so tokens that arrive at
 * once cannot all pass the wait.
 *
 * @param context - The request's context.
 * @param tokens - The sign-in and the throttle.
 * @param token - The token as sent.
 * @throws {AppError} `rate_limited` while the address waits.
 */
async function signInWithToken(
  context: Context<AppEnv>,
  tokens: TokenAuthentication,
  token: string,
): Promise<void> {
  const address = clientAddress(context, tokens.trustedProxyHops);
  const waitMs = tokens.failures.waitFor(address);
  const minutes = Math.ceil(waitMs / 60_000);
  if (waitMs > 0)
    throw new AppError('rate_limited', `Too many wrong tokens. Try again in ${minutes} min.`);
  tokens.failures.fail(address);
  const signedIn = await tokens.signIn(token);
  if (signedIn) tokens.failures.undo(address);
  else tokens.logger.warn('api token refused', { address, path: context.req.path });
  context.set('principal', signedIn?.principal ?? null);
  context.set('apiToken', signedIn?.token ?? null);
}

/**
 * Creates the middleware that identifies the principal of every request.
 *
 * @param authenticator - Identifies principals from their session cookie.
 * @param tokens - Signs a request in with an API token; without it no token signs in.
 * @returns The middleware. It sets `principal`, `null` when the request has no valid session or
 *   token, and `apiToken`, the token the request signed in with.
 */
export function authenticate(
  authenticator: Authenticator,
  tokens?: TokenAuthentication,
): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (context, next) => {
    const token = apiTokenOf(context.req.raw);
    context.set('apiToken', null);
    if (token === undefined)
      context.set('principal', await authenticator.authenticate(context.req.raw));
    else if (tokens) await signInWithToken(context, tokens, token);
    else context.set('principal', null);
    await next();
  });
}
