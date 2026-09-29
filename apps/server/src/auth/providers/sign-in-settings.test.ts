import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAccounts } from '../../accounts.ts';
import { createAuditRepository } from '../../db/audit-repository.ts';
import { openDatabase } from '../../db/database.ts';
import { runMigrations } from '../../db/migrate.ts';
import { createSettingsRepository } from '../../db/settings-repository.ts';
import { createSettingsStore } from '../../settings/settings-store.ts';
import { temporaryDir, testKeyedHashes, testSecretBox } from '../../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;
let accounts: ReturnType<typeof createAccounts>;

beforeEach(async () => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  const settings = createSettingsStore(createSettingsRepository(database));
  accounts = createAccounts(
    {
      database,
      settings,
      secretBox: await testSecretBox(),
      ...(await testKeyedHashes()),
      publicUrl: 'https://querent.test',
    },
    createAuditRepository(database),
  );
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/** A GitHub provider as an admin saves it. */
const github = {
  kind: 'github' as const,
  name: 'GitHub',
  baseUrl: null,
  tenant: null,
  join: { mode: 'invite' as const, values: [] },
};

describe('the sign-in settings', () => {
  test('seal the credentials, never send them back, and show the callback URL', async () => {
    await accounts.signInSettings.save(
      'github',
      { ...github, clientId: 'Iv1.abc', clientSecret: 'very-secret-value' },
      'admin',
    );
    const view = accounts.signInSettings.view();
    expect(view.providers).toMatchObject([
      {
        id: 'github',
        hasCredentials: true,
        enabled: false,
        callbackUrl: 'https://querent.test/api/auth/providers/github/callback',
      },
    ]);
    expect(JSON.stringify(view)).not.toContain('very-secret-value');
    expect(JSON.stringify(view)).not.toContain('Iv1.abc');
    const stored = database
      .query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'sign-in-credentials'")
      .get();
    expect(stored?.value).not.toContain('very-secret-value');
    expect(await accounts.signInSettings.credentials('github')).toEqual({
      clientId: 'Iv1.abc',
      clientSecret: 'very-secret-value',
    });
  });

  test('turn a provider off when it signs people in another way, but not for a new name', async () => {
    await accounts.signInSettings.save(
      'github',
      { ...github, clientId: 'a', clientSecret: 'b' },
      'admin',
    );
    accounts.signInSettings.markTested('github', 'admin');
    accounts.signInSettings.enable('github', true, 'admin');
    await accounts.signInSettings.save('github', { ...github, name: 'GitHub (work)' }, 'admin');
    expect(accounts.signInSettings.provider('github')?.enabled).toBe(true);
    await accounts.signInSettings.save('github', { ...github, clientSecret: 'rotated' }, 'admin');
    expect(accounts.signInSettings.provider('github')).toMatchObject({
      enabled: false,
      testedAt: null,
    });
  });

  test('keep passwords on until an admin can sign in through a provider', () => {
    expect(() => accounts.signInSettings.setPasswordSignIn(false, 'admin')).toThrow(
      'Link an admin',
    );
  });
});
