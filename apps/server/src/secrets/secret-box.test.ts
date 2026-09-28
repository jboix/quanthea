import { beforeAll, describe, expect, test } from 'bun:test';
import { createSecretBox, type SecretBox } from './secret-box.ts';

let box: SecretBox;

beforeAll(async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  box = createSecretBox(key);
});

describe('createSecretBox', () => {
  test('opens what it sealed for the same owner', async () => {
    const sealed = await box.seal('{"password":"s3cret"}', 'connector-1');
    expect(await box.open(sealed, 'connector-1')).toBe('{"password":"s3cret"}');
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

  test('refuses an unknown format version', async () => {
    const sealed = await box.seal('s3cret', 'connector-1');
    sealed[0] = 9;
    await expect(box.open(sealed, 'connector-1')).rejects.toThrow('Unknown sealed secret format.');
  });
});
