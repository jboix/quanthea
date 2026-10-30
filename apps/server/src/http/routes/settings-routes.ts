/**
 * The settings endpoints: the model gateway, for admins, and the providers a thread may use, for
 * editors.
 */
import {
  getModelSettingsEndpoint,
  listModelsEndpoint,
  listProviderChoicesEndpoint,
  saveModelSettingsEndpoint,
  testModelSettingsEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { z } from 'zod';
import { testModelConnection } from '../../agent/connection-test.ts';
import { type CatalogRequest, listModels } from '../../agent/model-catalog.ts';
import type { Managed } from '../../provisioning/managed.ts';
import type { ModelSettingsService } from '../../settings/model-settings.ts';
import {
  bearerFetch,
  clientCredentialsOf,
  modelTokens,
  TokenError,
} from '../../settings/model-token.ts';
import { storedKeyApplies } from '../../settings/provider-destination.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the endpoints that read, save and test the gateway. Saving is refused while the
 * configuration file manages it.
 *
 * @param app - The app.
 * @param modelSettings - The model gateway settings.
 * @param managed - What the configuration file manages.
 */
function mountGatewayRoutes(
  app: Hono<AppEnv>,
  modelSettings: ModelSettingsService,
  managed: Managed,
): void {
  mountEndpoint(app, getModelSettingsEndpoint, {
    access: 'admin',
    handle: () => modelSettings.view(),
  });
  mountEndpoint(app, saveModelSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => {
      managed.refuseChange('settings', 'model');
      return modelSettings.save(body.gateway, body.apiKeys, actorOf(principal));
    },
  });
  mountEndpoint(app, testModelSettingsEndpoint, {
    access: 'admin',
    handle: async ({ body }) => testModelConnection(await modelSettings.resolve(body.providerId)),
  });
}

/** A listing request, as the settings form sends it. */
type ListingBody = z.output<typeof listModelsEndpoint.body>;

/**
 * Lists the models with a key, or through an identity provider with a token.
 *
 * @param body - The listing request.
 * @param secret - The key or client secret: the typed one, or the stored one when it applies.
 * @returns The models, or why they could not be listed.
 */
async function catalogOf(body: ListingBody, secret: string | null) {
  const request: CatalogRequest = {
    provider: body.provider,
    baseUrl: body.baseUrl,
    apiKey: secret,
  };
  if (body.auth?.type !== 'oauth-client-credentials') return listModels(request);
  const credentials = clientCredentialsOf(body.auth, secret);
  if (credentials === null)
    return { ok: false as const, message: 'Enter the client secret to list the models.' };
  try {
    await modelTokens.token(credentials);
  } catch (error) {
    if (error instanceof TokenError) return { ok: false as const, message: error.message };
    throw error;
  }
  return listModels({ ...request, apiKey: 'token' }, bearerFetch(modelTokens, credentials));
}

/**
 * Mounts the endpoint that lists a vendor's models, for the settings form.
 *
 * @param app - The app.
 * @param modelSettings - The model gateway settings, for a saved provider's key.
 */
function mountModelListRoute(app: Hono<AppEnv>, modelSettings: ModelSettingsService): void {
  mountEndpoint(app, listModelsEndpoint, {
    access: 'admin',
    handle: async ({ body }) => {
      const saved = await modelSettings.resolve(body.providerId);
      // A stored secret only goes where it was saved for: the vendor, base URL and identity provider.
      const target = { ...saved.settings, auth: saved.auth, providerId: saved.providerId };
      const same = storedKeyApplies(body, target);
      const catalog = await catalogOf(body, body.apiKey ?? (same ? saved.apiKey : null));
      return catalog.ok
        ? { models: [...catalog.models], message: null }
        : { models: [], message: catalog.message };
    },
  });
}

/**
 * Mounts the endpoint that lists the providers a thread may use: names, not keys.
 *
 * @param app - The app.
 * @param modelSettings - The model gateway settings.
 */
function mountProviderChoicesRoute(app: Hono<AppEnv>, modelSettings: ModelSettingsService): void {
  mountEndpoint(app, listProviderChoicesEndpoint, {
    access: 'editor',
    handle: () => {
      const gateway = modelSettings.gateway();
      const providers = gateway.providers.map(({ id, name, provider, models }) => ({
        id,
        name,
        provider,
        buildModel: models.build,
      }));
      return { providers, defaultProviderId: gateway.defaultProviderId };
    },
  });
}

/**
 * Mounts the settings endpoints.
 *
 * @param app - The app.
 * @param modelSettings - The model gateway settings.
 * @param managed - What the configuration file manages.
 */
export function mountSettingsEndpoints(
  app: Hono<AppEnv>,
  modelSettings: ModelSettingsService,
  managed: Managed,
): void {
  mountGatewayRoutes(app, modelSettings, managed);
  mountModelListRoute(app, modelSettings);
  mountProviderChoicesRoute(app, modelSettings);
}
