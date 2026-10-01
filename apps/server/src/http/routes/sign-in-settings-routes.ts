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
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { LinkedIdentities } from '../../auth/providers/linked-identities.ts';
import type { SignInSettings } from '../../auth/providers/sign-in-settings.ts';
import type { Managed } from '../../provisioning/managed.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the sign-in settings endpoints need. */
export interface SignInRouteServices {
  /** The sign-in settings. */
  readonly signInSettings: SignInSettings;
  /** One's own linked providers. */
  readonly linkedIdentities: LinkedIdentities;
  /** What the configuration file manages. */
  readonly managed: Managed;
}

/**
 * The sign-in settings, each provider marked with the file that manages it, when one does.
 *
 * @param settings - The sign-in settings.
 * @param managed - What the configuration file manages.
 * @returns The view.
 */
function markedView(settings: SignInSettings, managed: Managed) {
  const view = settings.view();
  const providers = view.providers.map((provider) => {
    const path = managed.pathOf('provider', provider.id);
    return path ? { ...provider, managedBy: path } : provider;
  });
  return { ...view, providers };
}

/**
 * Mounts the admin endpoints that change one provider, refusing what the file manages.
 *
 * @param app - The app.
 * @param settings - The sign-in settings.
 * @param managed - What the configuration file manages.
 */
function mountProviderChanges(app: Hono<AppEnv>, settings: SignInSettings, managed: Managed): void {
  mountEndpoint(app, saveIdentityProviderEndpoint, {
    access: 'admin',
    handle: async ({ params, body, principal }) => {
      managed.refuseChange('provider', params.providerId);
      await settings.save(params.providerId, body, actorOf(principal));
      return markedView(settings, managed);
    },
  });
  mountEndpoint(app, enableIdentityProviderEndpoint, {
    access: 'admin',
    handle: ({ params, body, principal }) => {
      managed.refuseChange('provider', params.providerId);
      settings.enable(params.providerId, body.enabled, actorOf(principal));
      return markedView(settings, managed);
    },
  });
  mountEndpoint(app, removeIdentityProviderEndpoint, {
    access: 'admin',
    handle: ({ params, principal }) => {
      managed.refuseChange('provider', params.providerId);
      settings.remove(params.providerId, actorOf(principal));
      return markedView(settings, managed);
    },
  });
}

/**
 * Mounts the admin endpoints of the sign-in providers.
 *
 * @param app - The app.
 * @param settings - The sign-in settings.
 * @param managed - What the configuration file manages.
 */
function mountAdminEndpoints(app: Hono<AppEnv>, settings: SignInSettings, managed: Managed): void {
  mountEndpoint(app, getIdentityProvidersEndpoint, {
    access: 'admin',
    handle: () => markedView(settings, managed),
  });
  mountProviderChanges(app, settings, managed);
  mountEndpoint(app, passwordSignInEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => {
      managed.refuseChange('settings', 'password-sign-in');
      settings.setPasswordSignIn(body.enabled, actorOf(principal));
      return markedView(settings, managed);
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
  mountAdminEndpoints(app, services.signInSettings, services.managed);
  mountPersonalEndpoints(app, services);
}
