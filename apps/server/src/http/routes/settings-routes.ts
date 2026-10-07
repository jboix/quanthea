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
import { testModelConnection } from '../../agent/connection-test.ts';
import { listModels } from '../../agent/model-catalog.ts';
import type { Managed } from '../../provisioning/managed.ts';
import type { ModelSettingsService } from '../../settings/model-settings.ts';
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
      // A stored key only goes to the provider, vendor and base URL it was saved for.
      const same = storedKeyApplies(body, { ...saved.settings, providerId: saved.providerId });
      const catalog = await listModels({
        provider: body.provider,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey ?? (same ? saved.apiKey : null),
      });
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
