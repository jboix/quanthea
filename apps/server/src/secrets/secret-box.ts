/** Encrypts credentials at rest with AES-GCM, through WebCrypto. */

/** The first byte of every sealed value, so the format can change later. */
const formatVersion = 1;

/** The length of the random initialization vector, in bytes. */
const ivLength = 12;

/** Encrypts and decrypts credentials, each bound to what it belongs to. */
export interface SecretBox {
  /**
   * Encrypts a value.
   *
   * @param plaintext - The value, such as the JSON of a connector's credentials.
   * @param owner - What the value belongs to, such as the connector id. Opening it with another
   *   owner fails, so a sealed value cannot be moved to another row.
   * @returns The sealed bytes: version, IV, ciphertext and tag.
   */
  seal(plaintext: string, owner: string): Promise<Uint8Array>;
  /**
   * Decrypts a value sealed by {@link SecretBox.seal}.
   *
   * @param sealed - The sealed bytes.
   * @param owner - The owner the value was sealed for.
   * @returns The plaintext.
   * @throws {Error} When the bytes were altered, the key is wrong, or the owner differs.
   */
  open(sealed: Uint8Array, owner: string): Promise<string>;
}

/**
 * Creates a secret box over an AES-GCM key.
 *
 * @param key - A 256-bit AES-GCM key, from `loadSecretKey`.
 * @returns The secret box.
 */
export function createSecretBox(key: CryptoKey): SecretBox {
  const encoder = new TextEncoder();
  return {
    async seal(plaintext, owner) {
      const iv = crypto.getRandomValues(new Uint8Array(ivLength));
      const parameters = { name: 'AES-GCM', iv, additionalData: encoder.encode(owner) };
      const ciphertext = await crypto.subtle.encrypt(parameters, key, encoder.encode(plaintext));
      const sealed = new Uint8Array(1 + ivLength + ciphertext.byteLength);
      sealed.set([formatVersion], 0);
      sealed.set(iv, 1);
      sealed.set(new Uint8Array(ciphertext), 1 + ivLength);
      return sealed;
    },
    async open(sealed, owner) {
      if (sealed[0] !== formatVersion) throw new Error('Unknown sealed secret format.');
      const iv = sealed.slice(1, 1 + ivLength);
      const parameters = { name: 'AES-GCM', iv, additionalData: encoder.encode(owner) };
      const plaintext = await crypto.subtle.decrypt(parameters, key, sealed.slice(1 + ivLength));
      return new TextDecoder().decode(plaintext);
    },
  };
}
