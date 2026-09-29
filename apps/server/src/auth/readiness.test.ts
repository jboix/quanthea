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
    origins: {},
    secretKeyInDataDir: false,
    emailIndex: hash,
    fingerprints: hash,
    sessionHashes: { signature: hash, idHash: hash, tokenHash: hash },
    peppers: { current: { id: 'p1', hash }, previous: undefined },
    ...ring,
  };
}

describe('what accounts mode needs', () => {
  test('nothing more when every key is set and the public URL is known', async () => {
    const config = { publicUrl: 'https://querent.example.com' };
    expect(accountsProblems(config, await keyRing({}))).toEqual([]);
  });

  test('a secret key out of the data directory, and the public URL', async () => {
    const ring = await keyRing({ secretKeyInDataDir: true });
    const problems = accountsProblems({ publicUrl: undefined }, ring).join(' ');
    for (const name of ['QUERENT_SECRET_KEY_FILE', 'QUERENT_PUBLIC_URL']) {
      expect(problems).toContain(name);
    }
  });
});
