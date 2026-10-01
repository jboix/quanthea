/**
 * The IP address a request came from, for throttling. `X-Forwarded-For` is trusted only as far as
 * the configured number of proxies: each proxy appends the address it received from, so the
 * address that many entries from the right was written by a trusted proxy. Anything further left
 * could be set by the client.
 */
import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import type { AppEnv } from './app-env.ts';

/**
 * The client's address.
 *
 * @param context - The request context.
 * @param trustedProxyHops - How many proxies in front of quanthea append to `X-Forwarded-For`.
 * @returns The address, or `unknown` when neither the socket nor a trusted proxy tells.
 */
export function clientAddress(context: Context<AppEnv>, trustedProxyHops: number): string {
  if (trustedProxyHops > 0) {
    const forwarded = (context.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const address = forwarded[forwarded.length - trustedProxyHops];
    if (address) return address;
  }
  try {
    return getConnInfo(context).remote.address ?? 'unknown';
  } catch {
    // Outside Bun.serve, as in tests, there is no socket to ask.
    return 'unknown';
  }
}
