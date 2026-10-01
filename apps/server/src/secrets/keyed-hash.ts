/**
 * Keyed hashes: HMAC-SHA-256 under keys derived from a root key for one purpose each (HKDF), so a
 * value hashed for one purpose never matches another. Used for what must be found or checked but
 * never read back: session ids, one-time tokens, the lookup index of emails.
 */

/** A keyed hash function for one purpose. */
export interface KeyedHash {
  /**
   * Hashes a value.
   *
   * @param value - The value, such as a session id.
   * @returns The 32-byte hash.
   */
  hash(value: string): Promise<Uint8Array>;
  /**
   * Whether a value hashes to an expected hash, compared in constant time.
   *
   * @param value - The value.
   * @param expected - The hash it should have.
   * @returns Whether it does.
   */
  matches(value: string, expected: Uint8Array): Promise<boolean>;
}

/**
 * Whether two byte arrays are equal, in time that depends only on their length.
 *
 * @param first - One array.
 * @param second - The other.
 * @returns Whether they are equal.
 */
export function constantTimeEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= (first[index] ?? 0) ^ (second[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Derives the keyed hash of one purpose from a root key.
 *
 * @param root - The root key, 32 bytes.
 * @param purpose - A label naming the purpose and its version, such as `quanthea/session-id/v1`.
 * @returns The keyed hash.
 */
export async function keyedHash(
  root: Uint8Array<ArrayBuffer>,
  purpose: string,
): Promise<KeyedHash> {
  const encoder = new TextEncoder();
  const hkdf = await crypto.subtle.importKey('raw', root, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('quanthea'),
      info: encoder.encode(purpose),
    },
    hkdf,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
  const hash = async (value: string) =>
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return {
    hash,
    matches: async (value, expected) => constantTimeEqual(await hash(value), expected),
  };
}

/**
 * A random token: 32 bytes in base64url, for session ids and one-time links.
 *
 * @returns The token.
 */
export function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}
