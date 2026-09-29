import { beforeAll, describe, expect, test } from 'bun:test';
import { openSecretBox, type SecretBox } from './secret-box.ts';

let key: Uint8Array<ArrayBuffer>;
let box: SecretBox;

/**
 * A fresh random 32-byte key.
 *
 * @returns The key.
 */
function randomKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Seals a value the way querent did before sealed values carried a key id: the root key itself,
 * version 1.
 *
 * @param root - The root key.
 * @param plaintext - The value.
 * @param owner - The owner.
 * @returns The sealed bytes.
 */
async function sealLegacy(root: Uint8Array<ArrayBuffer>, plaintext: string, owner: string) {
  const aes = await crypto.subtle.importKey('raw', root, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const additionalData = encoder.encode(owner);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    aes,
    encoder.encode(plaintext),
  );
  return new Uint8Array([1, ...iv, ...new Uint8Array(data)]);
}

beforeAll(async () => {
  key = randomKey();
  box = await openSecretBox(key);
});

describe('the secret box', () => {
  test('opens what it sealed for the same owner', async () => {
    const sealed = await box.seal('{"password":"s3cret"}', 'connector-1');
    expect(await box.open(sealed, 'connector-1')).toBe('{"password":"s3cret"}');
    expect(box.isCurrent(sealed)).toBe(true);
  });

  test('never produces the same bytes twice, and never contains the plaintext', async () => {
    const first = await box.seal('s3cret', 'connector-1');
    const second = await box.seal('s3cret', 'connector-1');
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
    expect(Buffer.from(first).includes('s3cret')).toBe(false);
  });

  test('refuses to open a value for another owner', async () => {
    const sealed = await box.seal('s3cret', 'connector-1');
    await expect(box.open(sealed, 'connector-2')).rejects.toThrow();
  });

  test('refuses altered bytes', async () => {
    const sealed = await box.seal('s3cret', 'connector-1');
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 1;
    await expect(box.open(sealed, 'connector-1')).rejects.toThrow();
  });

  test('refuses an unknown format version, and a key it does not know', async () => {
    const sealed = await box.seal('s3cret', 'connector-1');
    const other = await openSecretBox(randomKey());
    await expect(other.open(sealed, 'connector-1')).rejects.toThrow(
      'No known key sealed this secret.',
    );
    sealed[0] = 9;
    await expect(box.open(sealed, 'connector-1')).rejects.toThrow('Unknown sealed secret format.');
  });

  test('opens what the previous key sealed, and marks it for sealing again', async () => {
    const sealed = await box.seal('s3cret', 'connector-1');
    const rotated = await openSecretBox(randomKey(), key);
    expect(await rotated.open(sealed, 'connector-1')).toBe('s3cret');
    expect(rotated.isCurrent(sealed)).toBe(false);
    expect(rotated.isCurrent(await rotated.seal('s3cret', 'connector-1'))).toBe(true);
  });

  test('opens values sealed before key ids, with the current or the previous key', async () => {
    const legacy = await sealLegacy(key, 's3cret', 'connector-1');
    expect(await box.open(legacy, 'connector-1')).toBe('s3cret');
    expect(box.isCurrent(legacy)).toBe(false);
    const rotated = await openSecretBox(randomKey(), key);
    expect(await rotated.open(legacy, 'connector-1')).toBe('s3cret');
  });
});
