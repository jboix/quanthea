/** The recipe endpoints: the settings, for admins, and the recipes a thread may use, for editors. */
import {
  getRecipeSettingsEndpoint,
  listRecipeChoicesEndpoint,
  saveRecipeSettingsEndpoint,
} from '@querent/shared';
import type { Hono } from 'hono';
import type { RecipeSettingsService } from '../../settings/recipe-settings.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint } from '../endpoint.ts';
import { actorOf } from '../principal.ts';

/**
 * Mounts the recipe endpoints.
 *
 * @param app - The app.
 * @param recipeSettings - The recipe settings.
 */
export function mountRecipeEndpoints(app: Hono<AppEnv>, recipeSettings: RecipeSettingsService) {
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
}
