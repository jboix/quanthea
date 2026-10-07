/**
 * The fetch every request to the model gateway goes through: listing models, testing the
 * connection and every model call. It follows the connectors' outbound policy.
 */
import { checkDestination } from '../connectors/_shared/index.ts';

/**
 * The URL a fetch input names.
 *
 * @param input - A URL, its text, or a request.
 * @returns The parsed URL.
 */
function urlOf(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input instanceof URL ? input.href : input);
}

/**
 * Sends a request to the model gateway. It calls only `http:` and `https:` URLs, never a cloud
 * metadata address (by the host or by what a name resolves to), and never follows a redirect: a
 * 3xx comes back as the response.
 *
 * @param input - The URL or request.
 * @param init - The request options; `redirect` is always `manual`.
 * @returns The response.
 * @throws {Error} When the URL is not HTTP or HTTPS, or points to a cloud metadata address.
 */
async function sendToGateway(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('The model gateway URL is not HTTP or HTTPS.');
  await checkDestination(url, 'model gateway');
  return fetch(input, { ...init, redirect: 'manual' });
}

/** {@link sendToGateway}, shaped as the global `fetch` the model SDK takes. */
export const gatewayFetch: typeof fetch = Object.assign(sendToGateway, {
  preconnect: fetch.preconnect,
});
