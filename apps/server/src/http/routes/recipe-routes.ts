/** The recipe endpoints: the settings, for admins, and the recipes a thread may use, for editors. */
import {
  getRecipeGuideEndpoint,
  getRecipeSettingsEndpoint,
  listRecipeChoicesEndpoint,
  previewRecipeEndpoint,
  saveRecipeSettingsEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { Connections } from '../../connections/connections.ts';
import type { Dashboards } from '../../dashboards/dashboards.ts';
import { previewPanel } from '../../dashboards/recipe-preview.ts';
import { builtInGuides } from '../../dashboards/recipes/guide.ts';
import type { RecipeSettingsService } from '../../settings/recipe-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/** The services the recipe endpoints use. */
export interface RecipeRouteServices {
  /** The recipe settings. */
  readonly recipeSettings: RecipeSettingsService;
  /** The dashboards, which validate and test-run a preview. */
  readonly dashboards: Dashboards;
  /** The connectors, which a preview can run on. */
  readonly connections: Connections;
}

/**
 * Mounts the endpoints that describe and preview recipes, for admins.
 *
 * @param app - The app.
 * @param services - The recipe settings, the dashboards and the connectors.
 */
function mountPreviewRoutes(app: Hono<AppEnv>, services: RecipeRouteServices): void {
  mountEndpoint(app, getRecipeGuideEndpoint, {
    access: 'admin',
    handle: () => {
      const connectors = services.connections
        .subjects()
        .map(({ subject, language }) => ({ name: subject.name, language }));
      return { recipes: builtInGuides(), connectors };
    },
  });
  mountEndpoint(app, previewRecipeEndpoint, {
    access: 'admin',
    handle: ({ body }) => {
      const stored = services.recipeSettings.get().saved;
      const draft = body.saved;
      const saved = draft ? [draft, ...stored.filter((each) => each.id !== draft.id)] : stored;
      return previewPanel(services.dashboards, body.panel, saved, body.from);
    },
  });
}

/**
 * Mounts the recipe endpoints.
 *
 * @param app - The app.
 * @param services - The recipe settings, the dashboards and the connectors.
 */
export function mountRecipeEndpoints(app: Hono<AppEnv>, services: RecipeRouteServices): void {
  const { recipeSettings } = services;
  mountEndpoint(app, getRecipeSettingsEndpoint, {
    access: 'admin',
    handle: () => recipeSettings.get(),
  });
  mountEndpoint(app, saveRecipeSettingsEndpoint, {
    access: 'admin',
    handle: ({ body, principal }) => recipeSettings.save(body, actorOf(principal)),
  });
  mountEndpoint(app, listRecipeChoicesEndpoint, {
    access: 'editor',
    handle: () => ({ recipes: recipeSettings.choices() }),
  });
  mountPreviewRoutes(app, services);
}
