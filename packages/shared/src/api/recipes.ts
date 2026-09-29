/**
 * Recipe endpoints: admins switch built-in recipes on and off and save their own; editors list
 * the recipes a new thread may use.
 */
import { z } from 'zod';
import { recipeSettingsSchema } from '../recipes.ts';
import { defineEndpoint } from './contract.ts';

/** The recipe settings, for admins. */
export const getRecipeSettingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/settings/recipes',
  output: recipeSettingsSchema,
});

/** Saves the recipe settings. */
export const saveRecipeSettingsEndpoint = defineEndpoint({
  method: 'PUT',
  path: '/settings/recipes',
  body: recipeSettingsSchema,
  output: recipeSettingsSchema,
});

/** A recipe as a new thread may choose it. */
export const recipeChoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  language: z.enum(['sql', 'promql']),
  /** Built into querent, or saved by an admin. */
  origin: z.enum(['built-in', 'saved']),
  /** Whether the default set includes it. */
  enabled: z.boolean(),
});

/** A recipe a thread may use. */
export type RecipeChoice = z.infer<typeof recipeChoiceSchema>;

/** The recipes a new thread may use, for editors. */
export const listRecipeChoicesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/recipes',
  output: z.object({ recipes: z.array(recipeChoiceSchema) }),
});
