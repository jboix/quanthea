/** Stores sessions, each by a keyed hash of its id. */
import type { Database } from 'bun:sqlite';

/** A session as stored. */
export interface SessionRow {
  /** A keyed hash of the session id. */
  readonly idHash: Uint8Array;
  /** Names the session in lists and when revoking it. */
  readonly publicId: string;
  /** The user. */
  readonly userId: string;
  /** Creation time. */
  readonly createdAt: number;
  /** The last request it made. */
  readonly lastSeenAt: number;
  /** The absolute end. */
  readonly expiresAt: number;
}

/** Stores sessions. */
export interface SessionRepository {
  /**
   * Inserts a session.
   *
   * @param row - The session.
   */
  create(row: SessionRow): void;
  /**
   * Finds a session by the hash of its id.
   *
   * @param idHash - The hash.
   * @returns The session, or `undefined`.
   */
  find(idHash: Uint8Array): SessionRow | undefined;
  /**
   * Records a request of a session.
   *
   * @param idHash - The hash of its id.
   * @param at - When.
   */
  touch(idHash: Uint8Array, at: number): void;
  /**
   * Lists a user's sessions, the most recent first.
   *
   * @param userId - The user.
   * @returns The sessions.
   */
  listByUser(userId: string): SessionRow[];
  /**
   * Deletes a session by the hash of its id.
   *
   * @param idHash - The hash.
   */
  remove(idHash: Uint8Array): void;
  /**
   * Deletes a user's session by its public id.
   *
   * @param userId - The user.
   * @param publicId - The session's public id.
   * @returns Whether one was deleted.
   */
  removePublic(userId: string, publicId: string): boolean;
  /**
   * Deletes every session of a user.
   *
   * @param userId - The user.
   * @returns How many were deleted.
   */
  removeAllOf(userId: string): number;
  /**
   * Deletes the sessions past their end or idle for too long.
   *
   * @param now - The current time.
   * @param idleSince - Sessions last seen before this are idle.
   * @returns How many were deleted.
   */
  removeExpired(now: number, idleSince: number): number;
}

/** A session as SQLite returns it. */
interface StoredSession {
  /** The id hash. */
  id_hash: Uint8Array;
  /** The public id. */
  public_id: string;
  /** The user. */
  user_id: string;
  /** Creation time. */
  created_at: number;
  /** The last request. */
  last_seen_at: number;
  /** The absolute end. */
  expires_at: number;
}

/**
 * Turns a stored row into a session.
 *
 * @param stored - The row.
 * @returns The session.
 */
function toSession(stored: StoredSession): SessionRow {
  return {
    idHash: new Uint8Array(stored.id_hash),
    publicId: stored.public_id,
    userId: stored.user_id,
    createdAt: stored.created_at,
    lastSeenAt: stored.last_seen_at,
    expiresAt: stored.expires_at,
  };
}

/**
 * The changes: a request recorded, and the deletions of one session, a user's, every one, or the
 * expired ones.
 *
 * @param database - The database.
 * @returns The methods.
 */
function changes(
  database: Database,
): Pick<SessionRepository, 'touch' | 'remove' | 'removePublic' | 'removeAllOf' | 'removeExpired'> {
  return {
    touch: (idHash, at) =>
      void database.run('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?', [at, idHash]),
    remove: (idHash) => {
      database.run('DELETE FROM sessions WHERE id_hash = ?', [idHash]);
    },
    removePublic: (userId, publicId) =>
      database.run('DELETE FROM sessions WHERE user_id = ? AND public_id = ?', [userId, publicId])
        .changes > 0,
    removeAllOf: (userId) =>
      database.run('DELETE FROM sessions WHERE user_id = ?', [userId]).changes,
    removeExpired: (now, idleSince) =>
      database.run('DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at < ?', [
        now,
        idleSince,
      ]).changes,
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createSessionRepository(database: Database): SessionRepository {
  const insert = database.query(
    `INSERT INTO sessions (id_hash, public_id, user_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectOne = database.query<StoredSession, [Uint8Array]>(
    'SELECT * FROM sessions WHERE id_hash = ?',
  );
  const selectByUser = database.query<StoredSession, [string]>(
    'SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC',
  );
  return {
    create: (row) => {
      insert.run(
        row.idHash,
        row.publicId,
        row.userId,
        row.createdAt,
        row.lastSeenAt,
        row.expiresAt,
      );
    },
    find: (idHash) => {
      const stored = selectOne.get(idHash);
      return stored ? toSession(stored) : undefined;
    },
    listByUser: (userId) => selectByUser.all(userId).map(toSession),
    ...changes(database),
  };
}
