/**
 * Seals the accounts' secrets again with the current key: users' names and emails, provider
 * identities and provider credentials. Emails and identities are indexed under the current key
 * too: after a key rotation, the old index would no longer find anyone.
 */
import type { IdentityRepository } from '../db/identity-repository.ts';
import type { UserRepository } from '../db/user-repository.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
import type { SettingsStore } from '../settings/settings-store.ts';
import { credentialsOwner } from './providers/provider-settings.ts';
import { normalizeEmail, sealedOwner } from './users.ts';

/**
 * Seals again the users not sealed with the current key.
 *
 * @param repository - The users.
 * @param secretBox - The secret box, which opens values the previous key sealed.
 * @param emailIndex - The email index under the current key.
 * @returns How many users were sealed again.
 */
export async function resealUsers(
  repository: UserRepository,
  secretBox: SecretBox,
  emailIndex: KeyedHash,
): Promise<number> {
  let count = 0;
  for (const row of repository.list()) {
    if (secretBox.isCurrent(row.emailSealed) && secretBox.isCurrent(row.nameSealed)) continue;
    const email = await secretBox.open(row.emailSealed, sealedOwner(row.id, 'email'));
    const name = await secretBox.open(row.nameSealed, sealedOwner(row.id, 'name'));
    repository.update(row.id, {
      emailIndex: await emailIndex.hash(normalizeEmail(email)),
      emailSealed: await secretBox.seal(email, sealedOwner(row.id, 'email')),
      nameSealed: await secretBox.seal(name, sealedOwner(row.id, 'name')),
      updatedAt: row.updatedAt,
    });
    count += 1;
  }
  return count;
}

/**
 * Seals every linked identity's subject again with the current key, and hashes it under the
 * current key: after a key rotation, the old hash would no longer find anyone.
 *
 * @param identities - The identities.
 * @param secretBox - The secret box, which opens values the previous key sealed.
 * @param lookupIndex - The lookup index under the current key.
 * @returns How many identities were sealed again.
 */
export async function resealIdentities(
  identities: IdentityRepository,
  secretBox: SecretBox,
  lookupIndex: KeyedHash,
): Promise<number> {
  let count = 0;
  for (const row of identities.list()) {
    if (secretBox.isCurrent(row.subjectSealed)) continue;
    const owner = `identity.${row.providerId}`;
    const subject = await secretBox.open(row.subjectSealed, owner);
    identities.reseal(row, {
      subjectIndex: await lookupIndex.hash(`identity:${row.providerId}:${subject}`),
      subjectSealed: await secretBox.seal(subject, owner),
    });
    count += 1;
  }
  return count;
}

/**
 * Seals every provider's client id and secret again with the current key.
 *
 * @param store - The settings store.
 * @param secretBox - The secret box, which opens values the previous key sealed.
 * @returns How many providers' credentials were sealed again.
 */
export async function resealSignInCredentials(
  store: SettingsStore,
  secretBox: SecretBox,
): Promise<number> {
  const sealed = { ...store.read('sign-in-credentials').sealed };
  let count = 0;
  for (const [id, value] of Object.entries(sealed)) {
    const bytes = Buffer.from(value, 'base64');
    if (secretBox.isCurrent(bytes)) continue;
    const credentials = await secretBox.open(bytes, credentialsOwner(id));
    sealed[id] = Buffer.from(await secretBox.seal(credentials, credentialsOwner(id))).toString(
      'base64',
    );
    count += 1;
  }
  if (count > 0) store.write('sign-in-credentials', { sealed });
  return count;
}
