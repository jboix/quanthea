import { describe, expect, test } from 'bun:test';
import { keyedHash } from '../secrets/keyed-hash.ts';
import type { Pepper, Peppers } from '../secrets/keys.ts';
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from './passwords.ts';

/** Cheap costs, for tests. */
const costs = { memoryCost: 1024, timeCost: 1 };

/**
 * A pepper over a fresh random key.
 *
 * @param id - Its id.
 * @returns The pepper.
 */
async function pepper(id: string): Promise<Pepper> {
  return { id, hash: await keyedHash(crypto.getRandomValues(new Uint8Array(32)), 'pepper') };
}

describe('password hashes', () => {
  test('verify the right password only, and hold neither it nor its pepper', async () => {
    const peppers: Peppers = { current: await pepper('p1'), previous: undefined };
    const stored = await hashPassword(peppers, 'a long pass phrase', costs);
    expect(stored.hash).toStartWith('$argon2id$v=19$m=1024,t=1,');
    expect(stored.hash).not.toContain('a long pass phrase');
    expect(await verifyPassword(peppers, 'a long pass phrase', stored)).toBe(true);
    expect(await verifyPassword(peppers, 'a long pass phrasf', stored)).toBe(false);
  });

  test('cannot be checked without the pepper that made them', async () => {
    const first: Peppers = { current: await pepper('p1'), previous: undefined };
    const stored = await hashPassword(first, 'a long pass phrase', costs);
    const other: Peppers = { current: await pepper('p1'), previous: undefined };
    expect(await verifyPassword(other, 'a long pass phrase', stored)).toBe(false);
    const gone: Peppers = { current: await pepper('p2'), previous: undefined };
    expect(await verifyPassword(gone, 'a long pass phrase', stored)).toBe(false);
  });

  test('verify with the previous pepper while it rotates out, and ask to be made again', async () => {
    const old = await pepper('p1');
    const stored = await hashPassword(
      { current: old, previous: undefined },
      'a long pass phrase',
      costs,
    );
    const rotating: Peppers = { current: await pepper('p2'), previous: old };
    expect(await verifyPassword(rotating, 'a long pass phrase', stored)).toBe(true);
    expect(needsRehash(rotating, stored, costs)).toBe(true);
    expect(needsRehash({ current: old, previous: undefined }, stored, costs)).toBe(false);
    expect(
      needsRehash({ current: old, previous: undefined }, stored, { ...costs, timeCost: 2 }),
    ).toBe(true);
  });
});

describe('the password policy', () => {
  const person = { email: 'grace.hopper@example.com', name: 'Grace Hopper' };

  test('accepts a long, unusual password', () => {
    expect(passwordProblem('correct orange lantern 42', person)).toBeUndefined();
  });

  test('refuses short, long, repetitive, common and personal passwords', () => {
    expect(passwordProblem('short1!', person)).toContain('at least 12');
    expect(passwordProblem('x'.repeat(257), person)).toContain('at most 256');
    expect(passwordProblem('aaaaaaaaaaaaaaaa', person)).toContain('too easy');
    expect(passwordProblem('Password1234', person)).toContain('too easy');
    expect(passwordProblem('grace.hopper-rules-2026', person)).toContain('name or email');
    expect(passwordProblem('i-am-GraceHopper-2026', person)).toContain('name or email');
  });
});
