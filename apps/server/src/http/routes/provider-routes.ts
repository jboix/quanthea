/**
 * Signing in through a provider: the start, which redirects to the provider, and the callback,
 * which comes back from it. Both are full-page GETs. Every failure redirects to a page with a
 * fixed code, never with anything the request carried.
 */
import { apiPrefix, providerFlowIntents } from '@querent/shared';
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sessionCookieName } from '../../auth/authenticator.ts';
import {
  FlowError,
  type FlowIntent,
  type FlowOutcome,
  type ProviderFlows,
} from '../../auth/providers/provider-flow.ts';
import { absoluteLimitMs } from '../../auth/sessions.ts';
import { accessMiddleware } from '../access.ts';
import type { AppEnv } from '../app-env.ts';
import { safeNext } from '../safe-next.ts';

/** The flow cookie's name without its `__Host-` prefix, which Hono adds. */
const flowCookie = 'querent_flow';

/** The flow cookie's lifetime, in seconds. */
const flowCookieSeconds = 600;

/** Where each kind of flow sends the person when it fails. */
const failurePages: Readonly<Record<FlowIntent, string>> = {
  'sign-in': '/login',
  link: '/account',
  test: '/settings/auth',
};

/**
 * The page to go to after a flow.
 *
 * @param outcome - How it ended.
 * @param providerId - The provider.
 * @returns The local path.
 */
function pageAfter(outcome: FlowOutcome, providerId: string): string {
  if (outcome.kind === 'tested') return `/settings/auth?tested=${encodeURIComponent(providerId)}`;
  if (outcome.kind === 'linked') return `/account?linked=${encodeURIComponent(providerId)}`;
  return safeNext(outcome.next);
}

/**
 * The page a failed flow goes to, with its code.
 *
 * @param error - What the flow threw.
 * @returns The local path.
 * @throws {unknown} Anything but a flow error.
 */
function pageAfterFailure(error: unknown): string {
  const failure = error instanceof FlowError ? error.failure : 'provider';
  const page = failurePages[error instanceof FlowError ? (error.intent ?? 'sign-in') : 'sign-in'];
  return `${page}?error=${failure}`;
}

/**
 * Sets the session cookie after a sign-in through a provider.
 *
 * @param context - The request context.
 * @param outcome - How the flow ended.
 */
function setSession(context: Context<AppEnv>, outcome: FlowOutcome): void {
  if (outcome.kind !== 'signed-in') return;
  setCookie(context, sessionCookieName.replace('__Host-', ''), outcome.cookie, {
    prefix: 'host',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: absoluteLimitMs / 1000,
  });
}

/**
 * Starts a flow and sets its cookie.
 *
 * @param context - The request context.
 * @param flows - The flows.
 * @param intent - What the flow is for.
 * @returns The redirect to the provider.
 */
async function startFlow(context: Context<AppEnv>, flows: ProviderFlows, intent: FlowIntent) {
  const started = await flows.start({
    providerId: context.req.param('providerId') ?? '',
    intent,
    next: safeNext(context.req.query('next')),
    principal: context.get('principal'),
  });
  setCookie(context, flowCookie, started.flowCookie, {
    prefix: 'host',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: flowCookieSeconds,
  });
  return context.redirect(started.location, 302);
}

/**
 * The start route: redirects to the provider, or back with a failure.
 *
 * @param flows - The flows, if any.
 * @returns The handler.
 */
function startHandler(flows: ProviderFlows | undefined) {
  return async (context: Context<AppEnv>) => {
    const asked = context.req.query('intent');
    const intent = providerFlowIntents.find((each) => each === asked) ?? 'sign-in';
    try {
      if (!flows) throw new FlowError('off');
      return await startFlow(context, flows, intent);
    } catch (error) {
      if (error instanceof FlowError) error.intent = intent;
      return context.redirect(pageAfterFailure(error), 302);
    }
  };
}

/**
 * The callback route: ends the flow, used once, and redirects to the page after it.
 *
 * @param flows - The flows, if any.
 * @returns The handler.
 */
function callbackHandler(flows: ProviderFlows | undefined) {
  return async (context: Context<AppEnv>) => {
    const cookie = getCookie(context, flowCookie, 'host');
    // A flow is used once, whatever happens next.
    deleteCookie(context, flowCookie, { prefix: 'host', path: '/', secure: true });
    try {
      if (!flows) throw new FlowError('off');
      const providerId = context.req.param('providerId') ?? '';
      const search = new URL(context.req.url).search;
      const principal = context.get('principal');
      const outcome = await flows.finish({ providerId, search, flowCookie: cookie, principal });
      setSession(context, outcome);
      return context.redirect(pageAfter(outcome, providerId), 302);
    } catch (error) {
      return context.redirect(pageAfterFailure(error), 302);
    }
  };
}

/**
 * Mounts the start and the callback of provider flows.
 *
 * @param app - The app.
 * @param flows - The flows, when querent has a public URL and sessions.
 */
export function mountProviderFlowRoutes(app: Hono<AppEnv>, flows: ProviderFlows | undefined): void {
  const base = `${apiPrefix}/auth/providers/:providerId`;
  app.get(`${base}/start`, accessMiddleware('public'), startHandler(flows));
  app.get(`${base}/callback`, accessMiddleware('public'), callbackHandler(flows));
}
