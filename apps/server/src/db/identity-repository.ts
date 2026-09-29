/** Stores links between provider identities and users. */
import type { Database } from 'bun:sqlite';

/** A provider identity linked to a user. */
export interface IdentityRow {
  /** The provider, as configured in querent. */
  readonly providerId: string;
  /** A keyed hash of the provider's subject. */
  readonly subjectIndex: Uint8Array;
  /** The subject, sealed. */
  readonly subjectSealed: Uint8Array;
  /** The user. */
  readonly userId: string;
  /** When it was linked. */
  readonly createdAt: number;
  /** The last sign-in through it. */
  readonly lastUsedAt: number | null;
}

/** Stores identities. */
export interface IdentityRepository {
  /**
   * Links an identity to a user.
   *
   * @param row - The identity.
   * @returns `false` when the identity is linked already.
   */
  link(row: IdentityRow): boolean;
  /**
   * Finds the identity of a provider's subject.
   *
   * @param providerId - The provider.
   * @param subjectIndex - The keyed hash of the subject.
   * @returns The identity, or `undefined`.
   */
  find(providerId: string, subjectIndex: Uint8Array): IdentityRow | undefined;
  /**
   * Lists a user's identities.
   *
   * @param userId - The user.
   * @returns The identities.
   */
  listOf(userId: string): IdentityRow[];
  /**
   * Lists every identity, to seal them again after a key rotation.
   *
   * @returns The identities.
   */
  list(): IdentityRow[];
  /**
   * Records a sign-in through an identity.
   *
   * @param providerId - The provider.
   * @param subjectIndex - The keyed hash of the subject.
   * @param at - When.
   */
  touch(providerId: string, subjectIndex: Uint8Array, at: number): void;
  /**
   * Replaces an identity's hash and sealed subject, after a key rotation.
   *
   * @param before - The identity as stored.
   * @param after - Its new hash and sealed subject.
   */
  reseal(before: IdentityRow, after: Pick<IdentityRow, 'subjectIndex' | 'subjectSealed'>): void;
  /**
   * Unlinks a user's identities at one provider, or at every provider.
   *
   * @param userId - The user.
   * @param providerId - The provider; every provider when left out.
   * @returns How many were unlinked.
   */
  unlink(userId: string, providerId?: string): number;
}

/** An identity as SQLite returns it. */
interface StoredIdentity {
  /** The provider. */
  provider_id: string;
  /** The subject hash. */
  subject_index: Uint8Array;
  /** The sealed subject. */
  subject_sealed: Uint8Array;
  /** The user. */
  user_id: string;
  /** Creation time. */
  created_at: number;
  /** The last use. */
  last_used_at: number | null;
}

/**
 * Turns a stored row into an identity.
 *
 * @param stored - The row.
 * @returns The identity.
 */
function toIdentity(stored: StoredIdentity): IdentityRow {
  return {
    providerId: stored.provider_id,
    subjectIndex: new Uint8Array(stored.subject_index),
    subjectSealed: new Uint8Array(stored.subject_sealed),
    userId: stored.user_id,
    createdAt: stored.created_at,
    lastUsedAt: stored.last_used_at,
  };
}

/**
 * Listing every identity, and the writes: touching, resealing and unlinking.
 *
 * @param database - The database.
 * @returns The methods.
 */
function writes(
  database: Database,
): Pick<IdentityRepository, 'list' | 'touch' | 'reseal' | 'unlink'> {
  return {
    list: () =>
      database.query<StoredIdentity, []>('SELECT * FROM identities').all().map(toIdentity),
    touch: (providerId, subjectIndex, at) =>
      void database.run(
        'UPDATE identities SET last_used_at = ? WHERE provider_id = ? AND subject_index = ?',
        [at, providerId, subjectIndex],
      ),
    reseal: (before, after) =>
      void database.run(
        `UPDATE identities SET subject_index = ?, subject_sealed = ?
         WHERE provider_id = ? AND subject_index = ?`,
        [after.subjectIndex, after.subjectSealed, before.providerId, before.subjectIndex],
      ),
    unlink: (userId, providerId) =>
      providerId === undefined
        ? database.run('DELETE FROM identities WHERE user_id = ?', [userId]).changes
        : database.run('DELETE FROM identities WHERE user_id = ? AND provider_id = ?', [
            userId,
            providerId,
          ]).changes,
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createIdentityRepository(database: Database): IdentityRepository {
  const insert = database.query(
    `INSERT OR IGNORE INTO identities
       (provider_id, subject_index, subject_sealed, user_id, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectOne = database.query<StoredIdentity, [string, Uint8Array]>(
    'SELECT * FROM identities WHERE provider_id = ? AND subject_index = ?',
  );
  const selectOf = database.query<StoredIdentity, [string]>(
    'SELECT * FROM identities WHERE user_id = ?',
  );
  return {
    link: (row) =>
      insert.run(
        row.providerId,
        row.subjectIndex,
        row.subjectSealed,
        row.userId,
        row.createdAt,
        row.lastUsedAt,
      ).changes > 0,
    find: (providerId, subjectIndex) => {
      const stored = selectOne.get(providerId, subjectIndex);
      return stored ? toIdentity(stored) : undefined;
    },
    listOf: (userId) => selectOf.all(userId).map(toIdentity),
    ...writes(database),
  };
}
