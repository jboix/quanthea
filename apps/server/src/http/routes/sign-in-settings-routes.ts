/**
 * The sign-in providers: their settings for admins, the ways to sign in for the login page, and
 * one's own linked providers.
 */
import {
  enableIdentityProviderEndpoint,
  getIdentityProvidersEndpoint,
  myIdentitiesEndpoint,
  passwordSignInEndpoint,
  removeIdentityProviderEndpoint,
  saveIdentityProviderEndpoint,
  signInOptionsEndpoint,
  unlinkIdentityEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { LinkedIdentities } from '../../auth/providers/linked-identities.ts';
import type { SignInSettings } from '../../auth/providers/sign-in-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the sign-in settings endpoints need. */
export interface SignInRouteServices {
  /** The sign-in settings. */
  readonly signInSettings: SignInSettings;
  /** One's own linked providers. */
  readonly linkedIdentities: LinkedIdentities;
}

/**
 * Mounts the admin endpoints of the sign-in providers.
 *
 * @param app - The app.
 * @param settings - The sign-in settings.
 */
function mountAdminEndpoints(app: Hono<AppEnv>, settings: SignInSettings): void {
  mountEndpoint(app, getIdentityProvidersEndpoint, {
    access: 'admin',
    handle: () => settings.view(),
  });
  mountEndpoint(app, saveIdentityProviderEndpoint, {
    access: 'admin',
    handle: async ({ params, body, principal }) => {
      await settings.save(params.providerId, body, actorOf(principal));
      return settings.view();
    },
  });
  mountEndpoint(app, enableIdentityProviderEndpoint, {
    access: 'admin',
    handle: ({ params, body, principal }) => {
      settings.enable(params.providerId, body.enabled, actorOf(principal));
      return settings.view();
    },
  });
  mountEndpoint(app, removeIdentityProviderEndpoint, {
    access: 'admin',
    handle: ({ params, principal }) => {
      settings.remove(params.providerId, actorOf(principal));
      return settings.view();
    },
  });
  mountEndpoint(app, passwordSignInEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => {
      settings.setPasswordSignIn(body.enabled, actorOf(principal));
      return settings.view();
    },
  });
}

/**
 * Mounts the ways to sign in, and one's own linked providers.
 *
 * @param app - The app.
 * @param services - The sign-in settings and one's linked providers.
 */
function mountPersonalEndpoints(app: Hono<AppEnv>, services: SignInRouteServices): void {
  const { signInSettings: settings, linkedIdentities } = services;
  mountEndpoint(app, signInOptionsEndpoint, {
    access: 'public',
    handle: () => ({
      passwordSignIn: settings.passwordSignIn(),
      providers: linkedIdentities.enabledProviders(),
    }),
  });
  mountEndpoint(app, myIdentitiesEndpoint, {
    access: 'viewer',
    handle: ({ principal }) => linkedIdentities.of(signedIn(principal).id),
  });
  mountEndpoint(app, unlinkIdentityEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => ({
      unlinked: linkedIdentities.unlink(signedIn(principal).id, params.providerId),
    }),
  });
}

/**
 * Mounts the sign-in settings endpoints.
 *
 * @param app - The app.
 * @param services - The sign-in settings and one's linked providers.
 */
export function mountSignInSettingsEndpoints(
  app: Hono<AppEnv>,
  services: SignInRouteServices,
): void {
  mountAdminEndpoints(app, services.signInSettings);
  mountPersonalEndpoints(app, services);
}
