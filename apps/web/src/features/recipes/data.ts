/** Loads the recipe settings and guide, and saves and previews recipes, through the API. */
import {
  getRecipeGuideEndpoint,
  getRecipeSettingsEndpoint,
  type previewRanges,
  previewRecipeEndpoint,
  type RecipeGuide,
  type RecipePreview,
  type RecipeSettings,
  type SavedRecipe,
  saveRecipeSettingsEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** A connector a preview can run on. */
export interface PreviewConnector {
  /** Its name. */
  readonly name: string;
  /** Its query language. */
  readonly language: 'sql' | 'promql';
}

/** How far back a preview looks. */
export type PreviewRange = (typeof previewRanges)[number];

/** What the recipes screen shows. */
export interface RecipesData {
  /** The settings as saved. */
  readonly settings: RecipeSettings;
  /** How each built-in recipe works. */
  readonly guides: readonly RecipeGuide[];
  /** The connectors a preview can run on. */
  readonly connectors: readonly PreviewConnector[];
}

/** What the recipes screen submits, as JSON. */
export type RecipesIntent =
  | { readonly intent: 'save'; readonly settings: RecipeSettings }
  | {
      readonly intent: 'preview';
      readonly panel: Readonly<Record<string, unknown>>;
      readonly saved?: SavedRecipe;
      readonly from: PreviewRange;
    };

/** What the action returns. */
export type RecipesOutcome =
  | { readonly intent: 'save'; readonly ok: true; readonly settings: RecipeSettings }
  | { readonly intent: 'save'; readonly ok: false; readonly message: string }
  | { readonly intent: 'preview'; readonly preview: RecipePreview };

/**
 * The loader of the recipes screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadRecipeSettings(api: ApiClient) {
  return async (): Promise<RecipesData> => {
    const [settings, guide] = await Promise.all([
      api.call(getRecipeSettingsEndpoint),
      api.call(getRecipeGuideEndpoint),
    ]);
    return { settings, guides: guide.recipes, connectors: guide.connectors };
  };
}

/**
 * Saves the settings, keeping a refusal as an outcome.
 *
 * @param api - The API client.
 * @param settings - The settings.
 * @returns The outcome.
 */
async function save(api: ApiClient, settings: RecipeSettings): Promise<RecipesOutcome> {
  try {
    const saved = await api.call(saveRecipeSettingsEndpoint, { body: settings });
    return { intent: 'save', ok: true, settings: saved };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'bad_request') throw error;
    return { intent: 'save', ok: false, message: error.message };
  }
}

/**
 * The action of the recipes screen: save the settings, or preview one panel.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function recipeSettingsAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<RecipesOutcome> => {
    const intent = (await request.json()) as RecipesIntent;
    if (intent.intent === 'save') return save(api, intent.settings);
    const { panel, saved, from } = intent;
    const body = { panel: { ...panel }, from, ...(saved ? { saved } : {}) };
    return { intent: 'preview', preview: await api.call(previewRecipeEndpoint, { body }) };
  };
}
