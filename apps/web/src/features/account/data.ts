/**
 * Signing in and out, and setting or changing a password, as route actions. A success is followed
 * by a full page load, so no cached session outlives it.
 */
import {
  changePasswordEndpoint,
  completeSetupEndpoint,
  type EndpointOutput,
  myIdentitiesEndpoint,
  setPasswordEndpoint,
  signInEndpoint,
  signOutEndpoint,
  signOutEverywhereEndpoint,
  unlinkIdentityEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
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

/** One's linked providers, those one may link, and whether one has a password. */
export type AccountIdentities = EndpointOutput<typeof myIdentitiesEndpoint>;

/**
 * The loader of the account menu: one’s providers.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAccount(api: ApiClient) {
  return ({ request }: LoaderFunctionArgs): Promise<AccountIdentities> =>
    api.call(myIdentitiesEndpoint, undefined, { signal: request.signal });
}

/**
 * The action of the setup page: the default admin's own email, name and password.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function setupAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<AccountOutcome> => {
    const { email, name, password } = (await request.json()) as Record<string, string>;
    try {
      const body = { email: email ?? '', name: name ?? '', password: password ?? '' };
      await api.call(completeSetupEndpoint, { body });
      return { ok: true, next: '/' };
    } catch (error) {
      return refusal(error);
    }
  };
}

/** What the account menu submits, as JSON. */
export type AccountIntent =
  | {
      readonly intent: 'change-password';
      readonly current: string;
      readonly password: string;
      readonly back: string;
    }
  | { readonly intent: 'unlink'; readonly providerId: string; readonly back: string }
  | { readonly intent: 'sign-out' }
  | { readonly intent: 'sign-out-everywhere' };

/**
 * Runs one account intent.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns The page to load next.
 */
async function runAccountIntent(api: ApiClient, intent: AccountIntent): Promise<string> {
  if (intent.intent === 'sign-out' || intent.intent === 'sign-out-everywhere') {
    await api.call(intent.intent === 'sign-out' ? signOutEndpoint : signOutEverywhereEndpoint);
    return '/login';
  }
  if (intent.intent === 'unlink') {
    await api.call(unlinkIdentityEndpoint, { params: { providerId: intent.providerId } });
    return `${safeNext(intent.back)}?account=unlinked`;
  }
  await api.call(changePasswordEndpoint, {
    body: { current: intent.current, password: intent.password },
  });
  return `${safeNext(intent.back)}?account=password-changed`;
}

/**
 * The action of the account menu: change the password, unlink a provider, or sign out.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function accountAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<AccountOutcome> => {
    try {
      return {
        ok: true,
        next: await runAccountIntent(api, (await request.json()) as AccountIntent),
      };
    } catch (error) {
      return refusal(error);
    }
  };
}
