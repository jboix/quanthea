/** The routes outside the app: signing in, setting up the default admin, and link passwords. */
import { signInOptionsEndpoint } from '@querent/shared';
import { type LoaderFunctionArgs, type RouteObject, redirect } from 'react-router';
import { ErrorPage } from '../app/error-page.tsx';
import { LoadingScreen } from '../app/layout.tsx';
import type { SessionLoader } from '../app/session.ts';
import {
  SetPasswordScreen,
  SetupScreen,
  SignInScreen,
  setPasswordAction,
  setupAction,
  signInAction,
} from '../features/account/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The sign-in route: it loads the ways to sign in. Someone already signed in goes where they were
 * headed.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function loginRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const loader = async ({ request }: LoaderFunctionArgs) => {
    if (!(await loadSession()))
      return api.call(signInOptionsEndpoint, undefined, { signal: request.signal });
    const next = new URL(request.url).searchParams.get('next');
    return redirect(next?.startsWith('/') && !next.startsWith('//') ? next : '/');
  };
  return {
    path: '/login',
    loader,
    action: signInAction(api),
    Component: SignInScreen,
    HydrateFallback: LoadingScreen,
    ErrorBoundary: ErrorPage,
  };
}

/**
 * The route where the default admin chooses their own email and password. Anyone else goes home;
 * someone signed out goes to the sign-in page.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function setupRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const loader = async () => {
    const session = await loadSession();
    if (!session) return redirect('/login');
    return session.principal.setupRequired ? null : redirect('/');
  };
  return {
    path: '/setup',
    loader,
    action: setupAction(api),
    Component: SetupScreen,
    HydrateFallback: LoadingScreen,
    ErrorBoundary: ErrorPage,
  };
}

/**
 * The route an invite or reset link opens. It needs no session: the link's token is the proof.
 *
 * @param api - The API client.
 * @returns The route object.
 */
export function setPasswordRoute(api: ApiClient): RouteObject {
  return {
    path: '/set-password',
    action: setPasswordAction(api),
    Component: SetPasswordScreen,
    ErrorBoundary: ErrorPage,
  };
}
