/** The settings endpoints: the model gateway. Admin only. */
import {
  getModelSettingsEndpoint,
  listModelsEndpoint,
  saveModelSettingsEndpoint,
  testModelSettingsEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import { testModelConnection } from '../../agent/connection-test.ts';
import { listModels } from '../../agent/model-catalog.ts';
import type { ModelSettingsService } from '../../settings/model-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the settings endpoints.
 *
 * @param app - The app.
 * @param modelSettings - The model gateway settings.
 */
export function mountSettingsEndpoints(
  app: Hono<AppEnv>,
  modelSettings: ModelSettingsService,
): void {
  mountEndpoint(app, getModelSettingsEndpoint, {
    access: 'admin',
    handle: () => modelSettings.view(),
  });
  mountEndpoint(app, saveModelSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) =>
      modelSettings.save(body.settings, body.apiKey, actorOf(principal)),
  });
  mountEndpoint(app, testModelSettingsEndpoint, {
    access: 'admin',
    handle: async () => testModelConnection(await modelSettings.resolve()),
  });
  mountEndpoint(app, listModelsEndpoint, {
    access: 'admin',
    handle: async ({ body }) => {
      const saved = await modelSettings.resolve();
      // The stored key only goes to the provider it was saved for.
      const storedKey = saved.settings.provider === body.provider ? saved.apiKey : null;
      const catalog = await listModels({
        provider: body.provider,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey ?? storedKey,
      });
      return catalog.ok
        ? { models: [...catalog.models], message: null }
        : { models: [], message: catalog.message };
    },
  });
}
