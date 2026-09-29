/**
 * Seals every user's name and email again with the current key, and indexes the email under the
 * current key: after a key rotation, the old index would no longer find anyone.
 */
import type { UserRepository } from '../db/user-repository.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';
import type { SecretBox } from '../secrets/secret-box.ts';
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
