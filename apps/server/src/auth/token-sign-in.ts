/**
 * Signing a request in with an API token: the token's owner, with the weaker of the token's role
 * and theirs, and which token it was. The default admin has no token until they have chosen their
 * own email and password.
 */
import { type Principal, weakerRole } from '@quanthea/shared';
import type { ApiTokens } from './api-tokens.ts';
import type { Users } from './users.ts';

/** The token a request signed in with. */
export interface TokenIdentity {
  /** Its public id. */
  readonly id: string;
  /** What its owner called it. */
  readonly name: string;
}

/** Who a token signs in, and with which token. */
export interface TokenSignIn {
  /** Who the request acts as. */
  readonly principal: Principal;
  /** The token. */
  readonly token: TokenIdentity;
}

/** Signs a token in; `null` when the token or its owner no longer signs in. */
export type SignInWithToken = (token: string) => Promise<TokenSignIn | null>;

/** What signing in with a token needs. */
export interface TokenSignInAccounts {
  /** The API tokens, when the session key is set. */
  readonly apiTokens: Pick<ApiTokens, 'resolve'> | undefined;
  /** The users. */
  readonly users: Pick<Users, 'principalOf'>;
}

/**
 * Creates the function that signs a token in.
 *
 * @param accounts - The API tokens and the users.
 * @returns The function.
 */
export function createTokenSignIn(accounts: TokenSignInAccounts): SignInWithToken {
  return async (token) => {
    const active = await accounts.apiTokens?.resolve(token);
    if (!active) return null;
    const owner = await accounts.users.principalOf(active.userId);
    if (!owner || owner.setupRequired) return null;
    const principal = { ...owner, role: weakerRole(owner.role, active.role) };
    return { principal, token: { id: active.id, name: active.name } };
  };
}
