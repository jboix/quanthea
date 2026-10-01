/** The signed-in session: who the user is. */
import { meEndpoint, type Principal } from '@quanthea/shared';
import { type ApiClient, ApiError } from '../lib/api-client.ts';

/** What the app knows about the current user. */
export interface Session {
  /** Who the user is and their role. */
  readonly principal: Principal;
}

/** Loads the session, or `null` when the user is not signed in. */
export type SessionLoader = () => Promise<Session | null>;

/**
 * Creates a session loader that asks the server once per page load. A sign-in or a role change
 * reloads the page, so the cached answer cannot go stale while the page lives.
 *
 * @param api - The API client.
 * @returns The loader. A failed request is not cached, so the next navigation retries.
 */
export function createSessionLoader(api: ApiClient): SessionLoader {
  let pending: Promise<Session | null> | undefined;
  const load = async (): Promise<Session | null> => {
    try {
      return await api.call(meEndpoint);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthorized') return null;
      pending = undefined;
      throw error;
    }
  };
  return () => {
    pending ??= load();
    return pending;
  };
}
