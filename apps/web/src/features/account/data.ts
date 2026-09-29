/**
 * Signing in and out, and setting or changing a password, as route actions. A success is followed
 * by a full page load, so no cached session outlives it.
 */
import {
  changePasswordEndpoint,
  setPasswordEndpoint,
  signInEndpoint,
  signOutEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What an account action answers: where to go next, or why not, by field. */
export type AccountOutcome =
  | { readonly ok: true; readonly next: string }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fields: Readonly<Record<string, string>>;
    };

/**
 * A local path to go to after signing in: it starts with one `/`, is not a path of the sign-in
 * pages, and holds no control characters. Anything else goes home, so no link can send a person
 * to another site.
 *
 * @param next - The path asked for.
 * @returns The path.
 */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length < 1 || next.length > 2048) return '/';
  const local = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\');
  const plain = [...next].every((character) => character >= ' ' && character !== '\u007f');
  return local && plain && !next.startsWith('/login') && !next.startsWith('/set-password')
    ? next
    : '/';
}

/**
 * The outcome of a refused call.
 *
 * @param error - What the call threw.
 * @returns The message and the problems by field.
 * @throws {unknown} The error, when it is not an API error.
 */
function refusal(error: unknown): AccountOutcome {
  if (!(error instanceof ApiError)) throw error;
  const issues = Array.isArray(error.details)
    ? (error.details as { path?: string; message?: string }[])
    : [];
  const fields = Object.fromEntries(
    issues.flatMap((issue) => (issue.path && issue.message ? [[issue.path, issue.message]] : [])),
  );
  return { ok: false, message: error.message, fields };
}

/**
 * The action of the sign-in page.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function signInAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<AccountOutcome> => {
    const { email, password, next } = (await request.json()) as Record<string, string>;
    try {
      await api.call(signInEndpoint, { body: { email: email ?? '', password: password ?? '' } });
      return { ok: true, next: safeNext(next) };
    } catch (error) {
      return refusal(error);
    }
  };
}

/**
 * The action of the set-password page.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function setPasswordAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<AccountOutcome> => {
    const { token, password } = (await request.json()) as Record<string, string>;
    try {
      await api.call(setPasswordEndpoint, {
        body: { token: token ?? '', password: password ?? '' },
      });
      return { ok: true, next: '/' };
    } catch (error) {
      return refusal(error);
    }
  };
}

/** What the account page submits, as JSON. */
export type AccountIntent =
  | { readonly intent: 'change-password'; readonly current: string; readonly password: string }
  | { readonly intent: 'sign-out' };

/**
 * The action of the account page: change the password, or sign out.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function accountAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<AccountOutcome> => {
    const intent = (await request.json()) as AccountIntent;
    try {
      if (intent.intent === 'sign-out') {
        await api.call(signOutEndpoint);
        return { ok: true, next: '/login' };
      }
      await api.call(changePasswordEndpoint, {
        body: { current: intent.current, password: intent.password },
      });
      return { ok: true, next: '/account?changed=1' };
    } catch (error) {
      return refusal(error);
    }
  };
}
