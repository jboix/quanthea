/**
 * The guide to edit_dashboard for one thread: only the recipes the thread may use, the saved ones
 * with their placeholders, and custom panels as the fallback or, with no recipes, the only way.
 */
import { builtInRecipes, type SavedRecipe } from '@querent/shared';
import type { AvailableRecipes } from '../dashboards/recipes/index.ts';
import { builtInHints, customGuide, editIntro, editRules, savedGuide } from './prompt-text.ts';

/**
 * The line of the built-in recipes of one language.
 *
 * @param label - Such as `PromQL recipes`.
 * @param language - The language.
 * @param ids - The recipes the thread may use.
 * @returns The line, or nothing when it may use none of them.
 */
function builtInLine(label: string, language: 'sql' | 'promql', ids: readonly string[]) {
  const listed = builtInRecipes
    .filter((recipe) => recipe.language === language && ids.includes(recipe.id))
    .map((recipe) => `${recipe.id} (${builtInHints[recipe.id] ?? recipe.description})`);
  return listed.length === 0 ? [] : [`${label}: ${listed.join(', ')}.`];
}

/**
 * One saved recipe as the guide lists it.
 *
 * @param recipe - The recipe.
 * @returns Such as `- "errors-by-route" (promql): What it shows. Placeholders: metric (metric).`
 */
function savedLine(recipe: SavedRecipe): string {
  const params = recipe.params.map((param) => {
    const described = param.description === '' ? '' : `: ${param.description}`;
    return `${param.name} (${param.kind}${described})`;
  });
  const placeholders = params.length === 0 ? '' : ` Placeholders: ${params.join('; ')}.`;
  return `- "${recipe.id}" (${recipe.language}, shows ${recipe.show}): ${recipe.description}${placeholders}`;
}

/**
 * The guide to edit_dashboard with the recipes a thread may use.
 *
 * @param available - The recipes.
 * @returns The guide.
 */
export function recipeGuideFor(available: AvailableRecipes): string {
  const none = available.builtIn.length === 0 && available.saved.length === 0;
  const recipes = [
    ...builtInLine('PromQL recipes', 'promql', available.builtIn),
    ...builtInLine('SQL recipes', 'sql', available.builtIn),
    ...(available.saved.length === 0 ? [] : [savedGuide, ...available.saved.map(savedLine)]),
  ];
  const custom = none
    ? `${customGuide} This thread uses no recipes: every panel is custom.`
    : `${customGuide} Prefer recipes: they do not break.`;
  return [editIntro, ...recipes, custom, editRules].join('\n');
}
