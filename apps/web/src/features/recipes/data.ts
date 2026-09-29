/** Loads and saves the recipe settings through the API. */
import {
  getRecipeSettingsEndpoint,
  type RecipeSettings,
  saveRecipeSettingsEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the recipes screen submits, as JSON. */
export interface RecipesIntent {
  /** The settings to save. */
  readonly settings: RecipeSettings;
}

/** What the action returns. */
export type RecipesOutcome =
  | { readonly ok: true; readonly settings: RecipeSettings }
  | { readonly ok: false; readonly message: string };

/**
 * The loader of the recipes screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadRecipeSettings(api: ApiClient) {
  return (): Promise<RecipeSettings> => api.call(getRecipeSettingsEndpoint);
}

/**
 * The action of the recipes screen: saves the settings, keeping a refusal as an outcome.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function recipeSettingsAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<RecipesOutcome> => {
    const { settings } = (await request.json()) as RecipesIntent;
    try {
      return { ok: true, settings: await api.call(saveRecipeSettingsEndpoint, { body: settings }) };
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
      return { ok: false, message: error.message };
    }
  };
}
