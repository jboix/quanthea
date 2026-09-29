import { describe, expect, test } from 'bun:test';
import { keyedHash } from '../secrets/keyed-hash.ts';
import type { KeyRing } from '../secrets/keys.ts';
import { testSecretBox } from '../test/fixtures.ts';
import { accountsProblems } from './readiness.ts';

/**
 * A key ring with every key, and some fields replaced.
 *
 * @param ring - The fields to replace.
 * @returns The key ring.
 */
async function keyRing(ring: Partial<KeyRing>): Promise<KeyRing> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const hash = await keyedHash(key, 'test');
  return {
    secretBox: await testSecretBox(),
    secretKeyOrigin: 'configured',
    emailIndex: hash,
    sessionHashes: { signature: hash, idHash: hash, tokenHash: hash },
    pepper: key,
    pepperPrevious: undefined,
    ...ring,
  };
}

describe('what accounts mode needs', () => {
  test('nothing more when every key is set and the public URL is known', async () => {
    const config = { publicUrl: 'https://querent.example.com' };
    expect(accountsProblems(config, await keyRing({}))).toEqual([]);
  });

  test('a secret key out of the data directory, both other keys, and the public URL', async () => {
    const ring = await keyRing({
      secretKeyOrigin: 'data-dir',
      sessionHashes: undefined,
      pepper: undefined,
    });
    const problems = accountsProblems({ publicUrl: undefined }, ring).join(' ');
    for (const name of [
      'QUERENT_SECRET_KEY',
      'QUERENT_SESSION_KEY',
      'QUERENT_PASSWORD_PEPPER',
      'QUERENT_PUBLIC_URL',
    ]) {
      expect(problems).toContain(name);
    }
  });
});
