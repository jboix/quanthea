/** Stores one-time password links, each by a keyed hash of its token. */
import type { Database } from 'bun:sqlite';

/** What a link is for. */
export type LinkPurpose = 'invite' | 'reset';

/** A link as stored. */
export interface PasswordLinkRow {
  /** A keyed hash of the token. */
  readonly tokenHash: Uint8Array;
  /** The user whose password it sets. */
  readonly userId: string;
  /** An invite or a reset. */
  readonly purpose: LinkPurpose;
  /** When it stops working. */
  readonly expiresAt: number;
  /** Who made it. */
  readonly createdBy: string;
  /** When. */
  readonly createdAt: number;
}

/** Stores links. */
export interface PasswordLinkRepository {
  /**
   * Stores a link, and deletes the user's other links, so only the latest one works.
   *
   * @param row - The link.
   */
  replace(row: PasswordLinkRow): void;
  /**
   * Finds a link without using it up.
   *
   * @param tokenHash - The hash of its token.
   * @returns The link, or `undefined`.
   */
  find(tokenHash: Uint8Array): PasswordLinkRow | undefined;
  /**
   * Takes a link: returns it and deletes every link of its user, in one transaction.
   *
   * @param tokenHash - The hash of its token.
   * @returns The link, or `undefined`.
   */
  take(tokenHash: Uint8Array): PasswordLinkRow | undefined;
  /**
   * A user's link, the latest one, without using it up.
   *
   * @param userId - The user.
   * @returns The link, or `undefined` when the user has none.
   */
  latestOf(userId: string): PasswordLinkRow | undefined;
}

/** A link as SQLite returns it. */
interface StoredLink {
  /** The token hash. */
  token_hash: Uint8Array;
  /** The user. */
  user_id: string;
  /** The purpose. */
  purpose: LinkPurpose;
  /** The end. */
  expires_at: number;
  /** The maker. */
  created_by: string;
  /** Creation time. */
  created_at: number;
}

/**
 * Turns a stored row into a link.
 *
 * @param stored - The row.
 * @returns The link.
 */
function toLink(stored: StoredLink): PasswordLinkRow {
  return {
    tokenHash: new Uint8Array(stored.token_hash),
    userId: stored.user_id,
    purpose: stored.purpose,
    expiresAt: stored.expires_at,
    createdBy: stored.created_by,
    createdAt: stored.created_at,
  };
}

/**
 * Applies a function to a value that may be missing.
 *
 * @param value - The value, or `null` or `undefined`.
 * @param map - The function.
 * @returns Its result, or `undefined`.
 */
function mapDefined<Value, Result>(
  value: Value | null | undefined,
  map: (value: Value) => Result,
): Result | undefined {
  return value === null || value === undefined ? undefined : map(value);
}

/**
 * The statement that stores a link in place of the user's other links.
 *
 * @param database - A database the migrations have run on.
 * @returns A transaction that stores the link.
 */
function replacer(database: Database): (row: PasswordLinkRow) => void {
  const insert = database.query(
    `INSERT INTO password_links (token_hash, user_id, purpose, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const removeOfUser = database.query('DELETE FROM password_links WHERE user_id = ?');
  return database.transaction((row: PasswordLinkRow) => {
    removeOfUser.run(row.userId);
    insert.run(row.tokenHash, row.userId, row.purpose, row.expiresAt, row.createdBy, row.createdAt);
  });
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createPasswordLinkRepository(database: Database): PasswordLinkRepository {
  const removeOfUser = database.query('DELETE FROM password_links WHERE user_id = ?');
  const selectOne = database.query<StoredLink, [Uint8Array]>(
    'SELECT * FROM password_links WHERE token_hash = ?',
  );
  const selectOfUser = database.query<StoredLink, [string]>(
    'SELECT * FROM password_links WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
  );
  return {
    replace: replacer(database),
    find: (tokenHash) => mapDefined(selectOne.get(tokenHash), toLink),
    take: database.transaction((tokenHash: Uint8Array) => {
      const stored = selectOne.get(tokenHash);
      if (!stored) return undefined;
      removeOfUser.run(stored.user_id);
      return toLink(stored);
    }),
    latestOf: (userId) => mapDefined(selectOfUser.get(userId), toLink),
  };
}
