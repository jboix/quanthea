/** The Hono environment shared by every route and middleware. */
import type { Principal } from '@quanthea/shared';
import type { RequestIdVariables } from 'hono/request-id';
import type { TokenIdentity } from '../auth/token-sign-in.ts';

/** Variables set on the request context by the app's middleware. */
export interface AppEnv {
  /** Context variables. */
  Variables: RequestIdVariables & {
    /** Who the request acts as, or `null` when it carries no valid session. */
    principal: Principal | null;
    /** The API token the request signed in with, or `null` when it signed in another way. */
    apiToken: TokenIdentity | null;
  };
}
