/** The route of the recipes screen. */
import type { RouteObject } from 'react-router';
import { guarded } from '../app/route-access.ts';
import type { SessionLoader } from '../app/session.ts';
import {
  loadRecipeSettings,
  RecipesScreen,
  recipeSettingsAction,
} from '../features/recipes/index.ts';
import type { ApiClient } from '../lib/api-client.ts';

/**
 * The recipes route: its loader and its save action run for admins only.
 *
 * @param loadSession - Loads the current session.
 * @param api - The API client.
 * @returns The route object.
 */
export function recipeSettingsRoute(loadSession: SessionLoader, api: ApiClient): RouteObject {
  const path = '/settings/recipes';
  return {
    path,
    loader: guarded(loadSession, path, loadRecipeSettings(api)),
    action: guarded(loadSession, path, recipeSettingsAction(api)),
    Component: RecipesScreen,
  };
}
