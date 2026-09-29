/**
 * Sessions. A session id is 32 random bytes; the browser holds it in a cookie with an HMAC
 * signature, checked before any lookup, and the database holds only a keyed hash of it. A session
 * ends after 24 hours without a request, or 7 days after it began, whichever comes first.
 */
import type { SessionRepository } from '../db/session-repository.ts';
import { newId } from '../lib/ids.ts';
import { type KeyedHash, randomToken } from '../secrets/keyed-hash.ts';

/** How long a session may go without a request. */
export const idleLimitMs = 24 * 3_600_000;

/** How long a session lasts at most. */
export const absoluteLimitMs = 7 * 24 * 3_600_000;

/** How often a session's last request is written, at most. */
const touchEveryMs = 60_000;

/** A session a request carries. */
export interface ActiveSession {
  /** The user. */
  readonly userId: string;
  /** Names the session in lists. */
  readonly publicId: string;
}

/** A session as its owner sees it in a list. */
export interface SessionSummary {
  /** Names the session. */
  readonly publicId: string;
  /** When it began. */
  readonly createdAt: number;
  /** Its last request. */
  readonly lastSeenAt: number;
  /** When it ends at the latest. */
  readonly expiresAt: number;
}

/** What sessions need. */
export interface SessionsDependencies {
  /** Stores sessions. */
  readonly repository: SessionRepository;
  /** Signs the cookie value. */
  readonly signature: KeyedHash;
  /** Hashes the session id for storage. */
  readonly idHash: KeyedHash;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** Sessions. */
export interface Sessions {
  /**
   * Starts a session.
   *
   * @param userId - The user.
   * @returns The cookie value, and the session's public id.
   */
  start(userId: string): Promise<{ cookie: string; publicId: string }>;
  /**
   * The session a cookie value carries, when its signature holds and it has not ended. Records the
   * request.
   *
   * @param cookie - The cookie value.
   * @returns The session, or `null`.
   */
  resolve(cookie: string): Promise<ActiveSession | null>;
  /**
   * Ends the session a cookie value carries, if any.
   *
   * @param cookie - The cookie value.
   */
  end(cookie: string): Promise<void>;
  /**
   * Ends one of a user's sessions.
   *
   * @param userId - The user.
   * @param publicId - The session's public id.
   * @returns Whether it existed.
   */
  endOne(userId: string, publicId: string): boolean;
  /**
   * Ends every session of a user.
   *
   * @param userId - The user.
   * @returns How many ended.
   */
  endAllOf(userId: string): number;
  /**
   * Ends every session of everyone, such as when the authentication mode changes.
   *
   * @returns How many ended.
   */
  endEvery(): number;
  /**
   * Lists a user's sessions.
   *
   * @param userId - The user.
   * @returns The sessions, the most recent first.
   */
  list(userId: string): SessionSummary[];
  /**
   * Deletes the sessions that have ended.
   *
   * @returns How many were deleted.
   */
  purgeEnded(): number;
}

/**
 * The session id a cookie value carries, when its signature holds.
 *
 * @param signature - The keyed hash that signs.
 * @param cookie - The cookie value: the id and its signature, joined by a dot.
 * @returns The id, or `undefined`.
 */
async function verifiedId(signature: KeyedHash, cookie: string): Promise<string | undefined> {
  const [id, signed, ...rest] = cookie.split('.');
  if (!id || !signed || rest.length > 0 || id.length > 64 || signed.length > 64) return undefined;
  const expected = new Uint8Array(Buffer.from(signed, 'base64url'));
  return (await signature.matches(id, expected)) ? id : undefined;
}

/** The dependencies with the clock resolved. */
type Context = SessionsDependencies & { readonly now: () => number };

/**
 * The stored session a cookie value carries, with the hash it is stored under.
 *
 * @param context - The sessions' context.
 * @param cookie - The cookie value.
 * @returns The hash and the row, or `undefined` when the signature does not hold.
 */
async function find(context: Context, cookie: string) {
  const id = await verifiedId(context.signature, cookie);
  if (id === undefined) return undefined;
  const hash = await context.idHash.hash(id);
  return { hash, row: context.repository.find(hash) };
}

/**
 * Starts a session.
 *
 * @param context - The sessions' context.
 * @param userId - The user.
 * @returns The cookie value, and the session's public id.
 */
async function start(context: Context, userId: string) {
  const id = randomToken();
  const at = context.now();
  const publicId = newId();
  const idHash = await context.idHash.hash(id);
  context.repository.create({
    idHash,
    publicId,
    userId,
    createdAt: at,
    lastSeenAt: at,
    expiresAt: at + absoluteLimitMs,
  });
  const signed = Buffer.from(await context.signature.hash(id)).toString('base64url');
  return { cookie: `${id}.${signed}`, publicId };
}

/**
 * The session a cookie value carries, if it has not ended; an ended one is deleted.
 *
 * @param context - The sessions' context.
 * @param cookie - The cookie value.
 * @returns The session, or `null`.
 */
async function resolve(context: Context, cookie: string): Promise<ActiveSession | null> {
  const found = await find(context, cookie);
  if (!found?.row) return null;
  const at = context.now();
  const { row, hash } = found;
  if (row.expiresAt <= at || row.lastSeenAt + idleLimitMs <= at) {
    context.repository.remove(hash);
    return null;
  }
  if (at - row.lastSeenAt >= touchEveryMs) context.repository.touch(hash, at);
  return { userId: row.userId, publicId: row.publicId };
}

/**
 * Creates the sessions service.
 *
 * @param dependencies - The repository, the two keyed hashes and the clock.
 * @returns The service.
 */
export function createSessions(dependencies: SessionsDependencies): Sessions {
  const context: Context = { ...dependencies, now: dependencies.now ?? Date.now };
  const { repository, now } = context;
  return {
    start: (userId) => start(context, userId),
    resolve: (cookie) => resolve(context, cookie),
    end: async (cookie) => {
      const found = await find(context, cookie);
      if (found) repository.remove(found.hash);
    },
    endOne: (userId, publicId) => repository.removePublic(userId, publicId),
    endAllOf: (userId) => repository.removeAllOf(userId),
    endEvery: () => repository.removeEvery(),
    list: (userId) =>
      repository.listByUser(userId).map(({ publicId, createdAt, lastSeenAt, expiresAt }) => ({
        publicId,
        createdAt,
        lastSeenAt,
        expiresAt,
      })),
    purgeEnded: () => repository.removeExpired(now(), now() - idleLimitMs),
  };
}
