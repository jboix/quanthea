/**
 * API tokens. A person makes a token so an MCP client can read quanthea as them. The token is
 * shown once; the database holds only a keyed hash of it. It acts as its owner, with the weaker of
 * its role and theirs, until it expires or is revoked. It works on the MCP endpoint only
 * (`http/token-reach.ts`), so none is made while an admin has the MCP server turned off.
 */
import {
  type ApiAccessSettings,
  type ApiTokenView,
  apiTokenPrefix,
  hasRole,
  type Principal,
  type Role,
} from '@quanthea/shared';
import type { ApiTokenRepository, ApiTokenRow } from '../db/api-token-repository.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import { AppError } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { type KeyedHash, randomToken } from '../secrets/keyed-hash.ts';

/** How many tokens a person may hold at once. */
export const maximumTokensPerUser = 20;

/** How often a token's last request is written, at most. */
const touchEveryMs = 60_000;

/** A day, in milliseconds. */
const dayMs = 86_400_000;

/** What a person asks for when they make a token. */
export interface ApiTokenRequest {
  /** What they call it. */
  readonly name: string;
  /** The strongest role it acts with. */
  readonly role: Role;
  /** How many days it lasts. */
  readonly expiresInDays: number;
}

/** A token a request carries. */
export interface ActiveApiToken {
  /** Its public id, which names it in lists and in the record of what it did. */
  readonly id: string;
  /** What its owner called it. */
  readonly name: string;
  /** The user it acts as. */
  readonly userId: string;
  /** The strongest role it acts with. */
  readonly role: Role;
}

/** A token just made. */
export interface IssuedApiToken {
  /** The token itself, shown this once. */
  readonly token: string;
  /** How it is listed. */
  readonly details: ApiTokenView;
}

/** What API tokens need. */
export interface ApiTokensDependencies {
  /** Stores tokens. */
  readonly repository: ApiTokenRepository;
  /** Hashes a token for storage. */
  readonly tokenHash: KeyedHash;
  /** The API access settings, read at each use. */
  readonly settings: () => ApiAccessSettings;
  /** Records who made and revoked tokens. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** API tokens. */
export interface ApiTokens {
  /**
   * Makes a token for a person.
   *
   * @param owner - Who makes it; it acts as them.
   * @param request - Its name, role and lifetime.
   * @returns The token, shown this once, and how it is listed.
   * @throws {AppError} `forbidden` when tokens are off or the role is stronger than the owner's;
   *   `bad_request` when it would last too long; `conflict` when the owner holds too many.
   */
  issue(owner: Principal, request: ApiTokenRequest): Promise<IssuedApiToken>;
  /**
   * The token a request carries, when it has not expired. Records the request.
   *
   * @param token - The token as sent.
   * @returns The token's id, name, user and role, or `null`.
   */
  resolve(token: string): Promise<ActiveApiToken | null>;
  /**
   * Lists a person's tokens.
   *
   * @param userId - The person.
   * @returns The tokens, the newest first.
   */
  list(userId: string): ApiTokenView[];
  /**
   * Revokes one of a person's tokens.
   *
   * @param userId - The person.
   * @param publicId - The token's id.
   * @param actor - Who revokes it.
   * @returns Whether it existed.
   */
  revoke(userId: string, publicId: string, actor: string): boolean;
  /**
   * Revokes every token of a person.
   *
   * @param userId - The person.
   * @param actor - Who revokes them.
   * @returns How many were revoked.
   */
  revokeAllOf(userId: string, actor: string): number;
  /**
   * Revokes every token of everyone.
   *
   * @param actor - Who revokes them.
   * @returns How many were revoked.
   */
  revokeEvery(actor: string): number;
  /**
   * Deletes the tokens that have expired.
   *
   * @returns How many were deleted.
   */
  purgeExpired(): number;
}

/** The dependencies with the clock resolved. */
type Context = ApiTokensDependencies & { readonly now: () => number };

/**
 * A stored token as its owner sees it.
 *
 * @param row - The stored token.
 * @returns The view, without the hash.
 */
function viewOf(row: ApiTokenRow): ApiTokenView {
  return {
    id: row.publicId,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Refuses a token that may not be made.
 *
 * @param context - The tokens' context.
 * @param owner - Who makes it.
 * @param request - What they ask for.
 * @throws {AppError} As {@link ApiTokens.issue} says.
 */
function refuseUnlessAllowed(context: Context, owner: Principal, request: ApiTokenRequest): void {
  const { mcp, maxLifetimeDays } = context.settings();
  if (!mcp) throw new AppError('forbidden', 'The MCP server is turned off.');
  if (!hasRole(owner.role, request.role))
    throw new AppError('forbidden', `A token's role cannot be stronger than yours, ${owner.role}.`);
  if (request.expiresInDays > maxLifetimeDays)
    throw new AppError('bad_request', `A token lasts ${maxLifetimeDays} days at most.`);
  if (context.repository.listByUser(owner.id).length >= maximumTokensPerUser)
    throw new AppError(
      'conflict',
      `You have ${maximumTokensPerUser} tokens already. Revoke one first.`,
    );
}

/**
 * Makes a token for a person.
 *
 * @param context - The tokens' context.
 * @param owner - Who makes it.
 * @param request - Its name, role and lifetime.
 * @returns The token and how it is listed.
 */
async function issue(
  context: Context,
  owner: Principal,
  request: ApiTokenRequest,
): Promise<IssuedApiToken> {
  refuseUnlessAllowed(context, owner, request);
  const token = `${apiTokenPrefix}${randomToken()}`;
  const at = context.now();
  const row: ApiTokenRow = {
    tokenHash: await context.tokenHash.hash(token),
    publicId: newId(),
    userId: owner.id,
    name: request.name,
    role: request.role,
    createdAt: at,
    expiresAt: at + request.expiresInDays * dayMs,
    lastUsedAt: null,
  };
  context.repository.create(row);
  const detail = { name: row.name, role: row.role, expiresAt: row.expiresAt };
  context.audit.append({ actor: owner.id, action: 'token.create', target: row.publicId, detail });
  return { token, details: viewOf(row) };
}

/**
 * The token a request carries, if it has not expired.
 *
 * @param context - The tokens' context.
 * @param token - The token as sent.
 * @returns The token's id, name, user and role, or `null`.
 */
async function resolve(context: Context, token: string): Promise<ActiveApiToken | null> {
  if (!token.startsWith(apiTokenPrefix)) return null;
  const hash = await context.tokenHash.hash(token);
  const row = context.repository.find(hash);
  const at = context.now();
  if (!row || row.expiresAt <= at) return null;
  if (at - (row.lastUsedAt ?? 0) >= touchEveryMs) context.repository.touch(hash, at);
  return { id: row.publicId, name: row.name, userId: row.userId, role: row.role };
}

/**
 * Creates the API tokens service.
 *
 * @param dependencies - The repository, the keyed hash, the settings, the audit log and the clock.
 * @returns The service.
 */
export function createApiTokens(dependencies: ApiTokensDependencies): ApiTokens {
  const context: Context = { ...dependencies, now: dependencies.now ?? Date.now };
  const { repository, audit } = context;
  return {
    issue: (owner, request) => issue(context, owner, request),
    resolve: (token) => resolve(context, token),
    list: (userId) => repository.listByUser(userId).map(viewOf),
    revoke: (userId, publicId, actor) => {
      const revoked = repository.removePublic(userId, publicId);
      if (revoked) audit.append({ actor, action: 'token.revoke', target: publicId });
      return revoked;
    },
    revokeAllOf: (userId, actor) => {
      const revoked = repository.removeAllOf(userId);
      if (revoked > 0) audit.append({ actor, action: 'token.revoke-all', target: userId });
      return revoked;
    },
    revokeEvery: (actor) => {
      const revoked = repository.removeAll();
      audit.append({ actor, action: 'token.revoke-every', detail: { revoked } });
      return revoked;
    },
    purgeExpired: () => repository.removeExpired(context.now()),
  };
}
