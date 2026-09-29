/** Settings → Users: the loader, and the action that invites, changes and resets users. */
import {
  endUserSessionsEndpoint,
  inviteUserEndpoint,
  listUsersEndpoint,
  type Role,
  resetLinkEndpoint,
  type UserView,
  updateUserEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the users screen shows. */
export interface UsersData {
  /** Every user, the oldest first. */
  readonly users: readonly UserView[];
}

/** What the users screen submits, as JSON. */
export type UsersIntent =
  | {
      readonly intent: 'invite';
      readonly email: string;
      readonly name: string;
      readonly role: Role;
    }
  | {
      readonly intent: 'update';
      readonly userId: string;
      readonly role?: Role;
      readonly disabled?: boolean;
    }
  | { readonly intent: 'reset-link'; readonly userId: string }
  | { readonly intent: 'end-sessions'; readonly userId: string };

/** What an intent answers: a link to hand over, a plain success, or why not. */
export type UsersOutcome =
  | {
      readonly ok: true;
      readonly link?: { readonly url: string; readonly expiresAt: number; readonly name: string };
    }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the users screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadUsers(api: ApiClient) {
  return ({ request }: LoaderFunctionArgs): Promise<UsersData> =>
    api.call(listUsersEndpoint, undefined, { signal: request.signal });
}

/**
 * A link made absolute with this page's origin, when the server gave a path only.
 *
 * @param link - The link from the server.
 * @returns The absolute link.
 */
function absolute(link: string): string {
  return new URL(link, window.location.origin).href;
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns The outcome.
 */
async function run(api: ApiClient, intent: UsersIntent): Promise<UsersOutcome> {
  if (intent.intent === 'invite') {
    const { email, name, role } = intent;
    const { invite } = await api.call(inviteUserEndpoint, { body: { email, name, role } });
    return { ok: true, link: { url: absolute(invite.link), expiresAt: invite.expiresAt, name } };
  }
  const params = { userId: intent.userId };
  if (intent.intent === 'reset-link') {
    const reset = await api.call(resetLinkEndpoint, { params });
    return { ok: true, link: { url: absolute(reset.link), expiresAt: reset.expiresAt, name: '' } };
  }
  if (intent.intent === 'end-sessions') {
    await api.call(endUserSessionsEndpoint, { params });
    return { ok: true };
  }
  const { role, disabled } = intent;
  const body = { ...(role ? { role } : {}), ...(disabled === undefined ? {} : { disabled }) };
  await api.call(updateUserEndpoint, { params, body });
  return { ok: true };
}

/**
 * The action of the users screen.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function changeUsers(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<UsersOutcome> => {
    try {
      return await run(api, (await request.json()) as UsersIntent);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}
