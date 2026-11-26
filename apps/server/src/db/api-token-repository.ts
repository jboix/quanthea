/** Stores API tokens, each by a keyed hash of the token. */
import type { Database } from 'bun:sqlite';
import type { Role } from '@quanthea/shared';

/** An API token as stored. */
export interface ApiTokenRow {
  /** A keyed hash of the token. */
  readonly tokenHash: Uint8Array;
  /** Names the token in lists and when revoking it. */
  readonly publicId: string;
  /** The user it acts as. */
  readonly userId: string;
  /** What its owner called it. */
  readonly name: string;
  /** The strongest role it acts with. */
  readonly role: Role;
  /** Creation time. */
  readonly createdAt: number;
  /** When it stops working. */
  readonly expiresAt: number;
  /** The last request it signed in, or `null` when it was never used. */
  readonly lastUsedAt: number | null;
}

/** Stores API tokens. */
export interface ApiTokenRepository {
  /**
   * Inserts a token.
   *
   * @param row - The token.
   */
  create(row: ApiTokenRow): void;
  /**
   * Finds a token by its hash.
   *
   * @param tokenHash - The hash.
   * @returns The token, or `undefined`.
   */
  find(tokenHash: Uint8Array): ApiTokenRow | undefined;
  /**
   * Records a request a token signed in.
   *
   * @param tokenHash - The hash of the token.
   * @param at - When.
   */
  touch(tokenHash: Uint8Array, at: number): void;
  /**
   * Lists a user's tokens, the newest first.
   *
   * @param userId - The user.
   * @returns The tokens.
   */
  listByUser(userId: string): ApiTokenRow[];
  /**
   * Deletes a user's token by its public id.
   *
   * @param userId - The user.
   * @param publicId - The token's public id.
   * @returns Whether one was deleted.
   */
  removePublic(userId: string, publicId: string): boolean;
  /**
   * Deletes every token of a user.
   *
   * @param userId - The user.
   * @returns How many were deleted.
   */
  removeAllOf(userId: string): number;
  /**
   * Deletes every token of everyone.
   *
   * @returns How many were deleted.
   */
  removeAll(): number;
  /**
   * Deletes the tokens past their end.
   *
   * @param now - The current time.
   * @returns How many were deleted.
   */
  removeExpired(now: number): number;
}

/** A token as SQLite returns it. */
interface StoredToken {
  /** The token hash. */
  token_hash: Uint8Array;
  /** The public id. */
  public_id: string;
  /** The user. */
  user_id: string;
  /** The name. */
  name: string;
  /** The role. */
  role: Role;
  /** Creation time. */
  created_at: number;
  /** The end. */
  expires_at: number;
  /** The last request. */
  last_used_at: number | null;
}

/**
 * Turns a stored row into a token.
 *
 * @param stored - The row.
 * @returns The token.
 */
function toToken(stored: StoredToken): ApiTokenRow {
  return {
    tokenHash: new Uint8Array(stored.token_hash),
    publicId: stored.public_id,
    userId: stored.user_id,
    name: stored.name,
    role: stored.role,
    createdAt: stored.created_at,
    expiresAt: stored.expires_at,
    lastUsedAt: stored.last_used_at,
  };
}

/**
 * The changes: a request recorded, and the deletions of one token, a user's, all, or the expired
 * ones.
 *
 * @param database - The database.
 * @returns The methods.
 */
function changes(
  database: Database,
): Pick<
  ApiTokenRepository,
  'touch' | 'removePublic' | 'removeAllOf' | 'removeAll' | 'removeExpired'
> {
  return {
    touch: (tokenHash, at) =>
      void database.run('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?', [
        at,
        tokenHash,
      ]),
    removePublic: (userId, publicId) =>
      database.run('DELETE FROM api_tokens WHERE user_id = ? AND public_id = ?', [userId, publicId])
        .changes > 0,
    removeAllOf: (userId) =>
      database.run('DELETE FROM api_tokens WHERE user_id = ?', [userId]).changes,
    removeAll: () => database.run('DELETE FROM api_tokens').changes,
    removeExpired: (now) =>
      database.run('DELETE FROM api_tokens WHERE expires_at <= ?', [now]).changes,
  };
}

/**
 * The statement that stores a token.
 *
 * @param database - The database.
 * @returns A function that inserts a token.
 */
function inserter(database: Database): ApiTokenRepository['create'] {
  const insert = database.query(
    `INSERT INTO api_tokens
       (token_hash, public_id, user_id, name, role, created_at, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return (row) => {
    const { tokenHash, publicId, userId, name, role, createdAt, expiresAt, lastUsedAt } = row;
    insert.run(tokenHash, publicId, userId, name, role, createdAt, expiresAt, lastUsedAt);
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createApiTokenRepository(database: Database): ApiTokenRepository {
  const selectOne = database.query<StoredToken, [Uint8Array]>(
    'SELECT * FROM api_tokens WHERE token_hash = ?',
  );
  const selectByUser = database.query<StoredToken, [string]>(
    'SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, public_id DESC',
  );
  return {
    create: inserter(database),
    find: (tokenHash) => {
      const stored = selectOne.get(tokenHash);
      return stored ? toToken(stored) : undefined;
    },
    listByUser: (userId) => selectByUser.all(userId).map(toToken),
    ...changes(database),
  };
}
