import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import type { PasswordAccounts } from './password-accounts.ts';
import { maximumVerifications } from './slots.ts';
import { accountRule } from './throttle.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** A strong password. */
const strong = 'violet harbour lantern 42';

/**
 * The test services' password accounts, with Ada's password set.
 *
 * @returns The password accounts and Ada's id.
 */
async function withAda(): Promise<{ passwords: PasswordAccounts; ada: string }> {
  const passwords = services.passwords;
  if (!passwords) throw new Error('The test services have no passwords.');
  const user = await services.users.create(
    { email: 'ada@example.com', name: 'Ada Lovelace', role: 'editor' },
    'x',
  );
  const { token } = await passwords.issueLink(user.id, 'invite', 'x');
  await passwords.setWithLink({ token, password: strong, address: '10.0.0.1' });
  return { passwords, ada: user.id };
}

/**
 * Runs attempts at once and counts the argon2id checks they make.
 *
 * @param attempts - The attempts.
 * @returns The checks made, and each attempt's error code.
 */
async function atOnce(
  attempts: readonly (() => Promise<unknown>)[],
): Promise<{ verifications: number; codes: string[] }> {
  const verify = spyOn(Bun.password, 'verify');
  try {
    const settled = await Promise.allSettled(attempts.map((attempt) => attempt()));
    const codes = settled.map((each) =>
      each.status === 'rejected' ? (each.reason as { code: string }).code : 'ok',
    );
    return { verifications: verify.mock.calls.length, codes };
  } finally {
    verify.mockRestore();
  }
}

describe('password accounts under concurrent guesses', () => {
  test('an account gets at most its free failures and one more check, however many arrive at once', async () => {
    const { passwords } = await withAda();
    const attempts = Array.from(
      { length: 30 },
      (_, index) => () =>
        passwords.signIn({
          email: 'ada@example.com',
          password: 'wrong guess here',
          address: `10.1.0.${index}`,
        }),
    );
    const { verifications, codes } = await atOnce(attempts);
    expect(verifications).toBeLessThanOrEqual(accountRule.freeFailures + 1);
    expect(codes).toContain('rate_limited');
    const signedIn = passwords.signIn({
      email: 'ada@example.com',
      password: strong,
      address: '10.2.0.1',
    });
    await expect(signedIn).rejects.toMatchObject({ code: 'rate_limited' });
  });

  test('changing a password checks the current one the same way', async () => {
    const { passwords, ada } = await withAda();
    const attempts = Array.from(
      { length: 30 },
      () => () =>
        passwords.change({ userId: ada, current: 'wrong guess here', password: `${strong}!` }),
    );
    const { verifications } = await atOnce(attempts);
    expect(verifications).toBeLessThanOrEqual(accountRule.freeFailures + 1);
  });

  test('a burst over many accounts runs a few checks at once, and refuses the rest', async () => {
    const { passwords } = await withAda();
    const attempts = Array.from(
      { length: 40 },
      (_, index) => () =>
        passwords.signIn({
          email: `person-${index}@example.com`,
          password: 'wrong guess here',
          address: `10.3.0.${index}`,
        }),
    );
    const { verifications, codes } = await atOnce(attempts);
    expect(verifications).toBeLessThanOrEqual(maximumVerifications);
    expect(codes).toContain('rate_limited');
  });

  test('a right password signs in, and takes back the failure it counted', async () => {
    const { passwords } = await withAda();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const right = { email: 'ada@example.com', password: strong, address: '10.4.0.1' };
      expect((await passwords.signIn(right)).userId).toBeString();
    }
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const wrong = { email: `who-${attempt}@example.com`, password: 'x', address: '10.4.0.1' };
      await expect(passwords.signIn(wrong)).rejects.toMatchObject({ code: 'unauthorized' });
    }
  });
});
