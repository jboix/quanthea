import { describe, expect, test } from 'bun:test';
import type { KeyRing } from '../secrets/keys.ts';
import { testSecretBox } from '../test/fixtures.ts';
import { accountsProblems } from './readiness.ts';

/**
 * A key ring with some keys.
 *
 * @param ring - The fields to set.
 * @returns The key ring.
 */
async function keyRing(ring: Partial<KeyRing>): Promise<KeyRing> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return {
    secretBox: await testSecretBox(),
    secretKeyOrigin: 'configured',
    session: key,
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
      session: undefined,
      pepper: undefined,
    });
    const problems = accountsProblems({ publicUrl: undefined }, ring);
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).toContain('QUERENT_SECRET_KEY');
    expect(problems.join(' ')).toContain('QUERENT_SESSION_KEY');
    expect(problems.join(' ')).toContain('QUERENT_PASSWORD_PEPPER');
    expect(problems.join(' ')).toContain('QUERENT_PUBLIC_URL');
  });
});
