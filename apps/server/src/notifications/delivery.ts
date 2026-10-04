/**
 * Posts one message to a service: a timeout on each attempt, up to two retries with backoff on a
 * network error, a 429 or a 5xx, a short `Retry-After` respected, and no redirect followed. It
 * never throws, and its errors never quote the target, which holds the channel's secret.
 */
import { isMetadataAddress } from '../connectors/_shared/index.ts';

/** How one message is posted. */
export interface DeliveryOptions {
  /** Posts a request; the platform's `fetch` in the server. */
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Waits between attempts. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Resolves a host name to its addresses, to refuse a metadata address behind a name. */
  readonly resolve: (host: string) => Promise<readonly string[]>;
  /** How long one attempt may take, in milliseconds. */
  readonly timeoutMs: number;
}

/** A request ready to post. */
export interface Outgoing {
  /** The URL. */
  readonly url: string;
  /** The headers. */
  readonly headers: Readonly<Record<string, string>>;
  /** The JSON body, serialized. */
  readonly body: string;
}

/** How a message went, after its retries. */
export interface Delivery {
  /** Whether the service took it. */
  readonly ok: boolean;
  /** The service's last HTTP status, or `null` when it never answered. */
  readonly httpStatus: number | null;
  /** How many attempts were made; 0 when the target was refused before any. */
  readonly attempts: number;
  /** Why it failed, or `null`. */
  readonly error: string | null;
}

/** One attempt's outcome, and whether another is worth it. */
interface Attempt extends Omit<Delivery, 'attempts'> {
  /** How long to wait before retrying, or `null` not to retry. */
  readonly retryAfterMs: number | null;
}

/** Attempts in all: the first and two retries. */
const maxAttempts = 3;

/** The waits before the retries, in milliseconds. */
const backoffMs = [1000, 4000];

/** The longest `Retry-After` honoured, in milliseconds; a longer one stops the retries. */
const maxRetryAfterMs = 30_000;

/** The most characters of a refusal's body kept in the error. */
const maxBodyQuote = 200;

/**
 * The wait a `Retry-After` header asks for.
 *
 * @param header - The header, in seconds or as an HTTP date.
 * @param fallbackMs - The backoff to use without one.
 * @returns The wait, or `null` when it is too long to wait for.
 */
function retryWait(header: string | null, fallbackMs: number): number | null {
  if (header === null) return fallbackMs;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (Number.isNaN(ms)) return fallbackMs;
  return ms > maxRetryAfterMs ? null : Math.max(ms, 0);
}

/**
 * Judges a service's answer.
 *
 * @param response - The answer.
 * @param attempt - Which attempt it was, from 1.
 * @returns The outcome.
 */
async function judge(response: Response, attempt: number): Promise<Attempt> {
  const httpStatus = response.status;
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: true, httpStatus, error: null, retryAfterMs: null };
  }
  const text = (await response.text().catch(() => '')).trim();
  if (httpStatus >= 300 && httpStatus < 400) {
    const error = 'The service answered with a redirect, which quanthea does not follow.';
    return { ok: false, httpStatus, error, retryAfterMs: null };
  }
  const quote = text ? `: ${text.slice(0, maxBodyQuote)}` : '';
  const error = `The service answered HTTP ${httpStatus}${quote}`;
  const retryable = httpStatus === 429 || httpStatus >= 500;
  const fallback = backoffMs[attempt - 1] ?? 0;
  const retryAfterMs = retryable ? retryWait(response.headers.get('retry-after'), fallback) : null;
  return { ok: false, httpStatus, error, retryAfterMs };
}

/**
 * Describes a failure to reach the service without quoting the URL.
 *
 * @param error - What `fetch` threw.
 * @returns The description.
 */
function unreachable(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError')
    return 'The service did not answer in time.';
  const code = (error as { code?: unknown } | null)?.code;
  const known = typeof code === 'string' && /^[A-Za-z_]{1,40}$/.test(code) ? ` (${code})` : '';
  return `The service could not be reached${known}.`;
}

/**
 * Makes one attempt.
 *
 * @param outgoing - The request.
 * @param options - How to post.
 * @param attempt - Which attempt, from 1.
 * @returns The outcome.
 */
async function attemptOnce(
  outgoing: Outgoing,
  options: DeliveryOptions,
  attempt: number,
): Promise<Attempt> {
  try {
    const response = await options.fetch(outgoing.url, {
      method: 'POST',
      headers: outgoing.headers,
      body: outgoing.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    return await judge(response, attempt);
  } catch (error) {
    const retryAfterMs = backoffMs[attempt - 1] ?? 0;
    return { ok: false, httpStatus: null, error: unreachable(error), retryAfterMs };
  }
}

/**
 * Why a URL may not be called, if it may not: a cloud metadata address, by name or by address.
 *
 * @param url - The URL.
 * @param resolve - Resolves a host name.
 * @returns The reason, or `null`.
 */
export async function refusedDestination(
  url: string,
  resolve: DeliveryOptions['resolve'],
): Promise<string | null> {
  const refused = 'The URL points to a cloud metadata address, which quanthea never calls.';
  const host = URL.canParse(url) ? new URL(url).hostname : '';
  if (!host) return 'The URL is not valid.';
  if (isMetadataAddress(host)) return refused;
  const addresses = await resolve(host.replace(/^\[|\]$/g, '')).catch(() => []);
  return addresses.some(isMetadataAddress) ? refused : null;
}

/**
 * Posts a message, retrying as the service allows.
 *
 * @param outgoing - The request.
 * @param options - How to post.
 * @returns How it went. It never throws.
 */
export async function deliver(outgoing: Outgoing, options: DeliveryOptions): Promise<Delivery> {
  const refused = await refusedDestination(outgoing.url, options.resolve);
  if (refused) return { ok: false, httpStatus: null, attempts: 0, error: refused };
  for (let attempt = 1; ; attempt += 1) {
    const { retryAfterMs, ...outcome } = await attemptOnce(outgoing, options, attempt);
    if (outcome.ok || retryAfterMs === null || attempt >= maxAttempts)
      return { ...outcome, attempts: attempt };
    await options.sleep(retryAfterMs);
  }
}

/**
 * Resolves a host name with the platform's resolver.
 *
 * @param host - The name, or an address.
 * @returns Its addresses; none when it does not resolve.
 */
export async function resolveHost(host: string): Promise<readonly string[]> {
  const entries = await Bun.dns.lookup(host).catch(() => []);
  return entries.map((entry) => entry.address);
}
