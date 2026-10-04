/**
 * Signs the generic webhook's requests. The signature covers the timestamp and the body, so a
 * receiver that checks both and refuses an old timestamp refuses a replayed request.
 */

/** The header carrying the signature, as `sha256=<hex>`. */
const signatureHeader = 'X-Quanthea-Signature';

/** The header carrying the time of signing, in Unix seconds. */
const timestampHeader = 'X-Quanthea-Timestamp';

/**
 * The hex HMAC-SHA-256 of `<timestamp>.<body>` with the channel's secret.
 *
 * @param secret - The channel's signing secret.
 * @param timestamp - The time of signing, in Unix seconds.
 * @param body - The serialized body, exactly as sent.
 * @returns The hex digest.
 */
export async function signBody(secret: string, timestamp: number, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return Buffer.from(mac).toString('hex');
}

/**
 * The headers that sign a body.
 *
 * @param secret - The channel's signing secret.
 * @param body - The serialized body.
 * @param nowMs - The time, in epoch milliseconds.
 * @returns The timestamp and signature headers.
 */
export async function signatureHeaders(
  secret: string,
  body: string,
  nowMs: number,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(nowMs / 1000);
  const digest = await signBody(secret, timestamp, body);
  return { [timestampHeader]: String(timestamp), [signatureHeader]: `sha256=${digest}` };
}
