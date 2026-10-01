/**
 * Seals secrets at rest with AES-256-GCM, bound to their owner (the row they belong to) through
 * the additional data, so a sealed value copied to another row does not open.
 *
 * A sealed value starts with its format version and the id of the key that sealed it, and is
 * sealed with a key derived from the root key for this purpose only (HKDF).
 */

/** The format: version, key id, IV, ciphertext and tag. */
const format = 1;

/** Bytes of a key id. */
const keyIdLength = 4;

/** Bytes of an AES-GCM IV. */
const ivLength = 12;

/** What the secrets key is derived for, so it never equals a key derived for anything else. */
const secretsInfo = 'quanthea/secrets/v1';

/** A root key's derived keys. */
interface DerivedKeys {
  /** The id sealed values carry. */
  readonly id: Uint8Array;
  /** The key values are sealed with. */
  readonly sealing: CryptoKey;
}

/** Seals and opens secrets. */
export interface SecretBox {
  /**
   * Encrypts a value with the current key.
   *
   * @param plaintext - The value, such as the JSON of a connector's credentials.
   * @param owner - What the value belongs to, such as the connector id. Opening it with another
   *   owner fails, so a sealed value cannot be moved to another row.
   * @returns The sealed bytes: version, key id, IV, ciphertext and tag.
   */
  seal(plaintext: string, owner: string): Promise<Uint8Array>;
  /**
   * Decrypts a value sealed by {@link SecretBox.seal}, with the current key or the previous one.
   *
   * @param sealed - The sealed bytes.
   * @param owner - The owner the value was sealed for.
   * @returns The plaintext.
   * @throws {Error} When the bytes were altered, no known key sealed them, or the owner differs.
   */
  open(sealed: Uint8Array, owner: string): Promise<string>;
  /**
   * Whether a value is sealed in the current format with the current key.
   *
   * @param sealed - The sealed bytes.
   * @returns `false` when it should be sealed again.
   */
  isCurrent(sealed: Uint8Array): boolean;
}

/**
 * Derives a root key's keys.
 *
 * @param root - The root key, 32 bytes.
 * @returns The key id and the sealing key.
 */
async function deriveKeys(root: Uint8Array<ArrayBuffer>): Promise<DerivedKeys> {
  const encoder = new TextEncoder();
  const hkdf = await crypto.subtle.importKey('raw', root, 'HKDF', false, ['deriveKey']);
  const derive = { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('querent') };
  const sealing = await crypto.subtle.deriveKey(
    { ...derive, info: encoder.encode(secretsInfo) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { id: await keyIdOf(root), sealing };
}

/**
 * A key's id: the first bytes of an HMAC of a fixed label, which says nothing about the key.
 *
 * @param root - The root key.
 * @returns The id.
 */
async function keyIdOf(root: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const hmac = await crypto.subtle.importKey(
    'raw',
    root,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode('quanthea/key-id'));
  return new Uint8Array(mac).slice(0, keyIdLength);
}

/**
 * Whether two byte arrays hold the same bytes.
 *
 * @param first - One array.
 * @param second - The other.
 * @returns Whether they are equal.
 */
function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}

/**
 * The error for a value no key querent was given can open: the database was sealed with another
 * secret key. The key id says nothing about the key itself.
 *
 * @param keyId - The id of the key that sealed it, in hex, or where the value comes from.
 * @returns The error.
 */
function unknownKey(keyId: string): Error {
  return new Error(
    `A secret in the database was sealed with a key querent was not given (key id ${keyId}). Set that key as QUANTHEA_SECRET_KEY, or as QUANTHEA_SECRET_KEY_PREVIOUS while moving to a new one.`,
  );
}

/**
 * Opens a value with whichever known key sealed it.
 *
 * @param keys - The current keys, then the previous ones.
 * @param sealed - The sealed bytes.
 * @param additionalData - The owner, encoded.
 * @returns The plaintext bytes.
 * @throws {Error} When no known key sealed it.
 */
function openSealed(
  keys: readonly DerivedKeys[],
  sealed: Uint8Array<ArrayBuffer>,
  additionalData: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const id = sealed.slice(1, 1 + keyIdLength);
  const key = keys.find((each) => sameBytes(each.id, id));
  if (!key) throw unknownKey(Buffer.from(id).toString('hex'));
  const iv = sealed.slice(1 + keyIdLength, 1 + keyIdLength + ivLength);
  const data = sealed.slice(1 + keyIdLength + ivLength);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key.sealing, data);
}

/**
 * Seals a value.
 *
 * @param key - The current keys.
 * @param plaintext - The value.
 * @param owner - What the value belongs to.
 * @returns Version, key id, IV, ciphertext and tag.
 */
async function sealWith(key: DerivedKeys, plaintext: string, owner: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(ivLength));
  const parameters = { name: 'AES-GCM', iv, additionalData: encoder.encode(owner) };
  const encrypted = await crypto.subtle.encrypt(parameters, key.sealing, encoder.encode(plaintext));
  const sealed = new Uint8Array(1 + keyIdLength + ivLength + encrypted.byteLength);
  sealed.set([format], 0);
  sealed.set(key.id, 1);
  sealed.set(iv, 1 + keyIdLength);
  sealed.set(new Uint8Array(encrypted), 1 + keyIdLength + ivLength);
  return sealed;
}

/**
 * Creates a secret box over the current root key and, while it is rotated out, the previous one.
 *
 * @param current - The current root key, 32 bytes.
 * @param previous - The previous root key, if a rotation is under way.
 * @returns The box.
 */
export async function openSecretBox(
  current: Uint8Array<ArrayBuffer>,
  previous?: Uint8Array<ArrayBuffer>,
): Promise<SecretBox> {
  const encoder = new TextEncoder();
  const keys = [await deriveKeys(current), ...(previous ? [await deriveKeys(previous)] : [])];
  const [active] = keys as [DerivedKeys, ...DerivedKeys[]];
  return {
    seal: (plaintext, owner) => sealWith(active, plaintext, owner),
    async open(sealed, owner) {
      const bytes = new Uint8Array(sealed);
      const additionalData = encoder.encode(owner);
      if (bytes[0] !== format) throw new Error('Unknown sealed secret format.');
      return new TextDecoder().decode(await openSealed(keys, bytes, additionalData));
    },
    isCurrent: (sealed) =>
      sealed[0] === format && sameBytes(sealed.slice(1, 1 + keyIdLength), active.id),
  };
}
