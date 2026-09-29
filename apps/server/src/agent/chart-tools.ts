/**
 * The tool that reads one chart recipe in full: the index in the instructions names them all in a
 * line each, and the agent reads the roles, variants and pitfalls of the ones it uses.
 */
import { type ChartRecipe, chartRecipe, chartRecipes } from '@querent/shared';
import { tool } from 'ai';
import { z } from 'zod';

/**
 * A recipe as the agent reads it: what it needs, what it offers, and what to avoid.
 *
 * @param recipe - The recipe.
 * @returns The card.
 */
export function recipeCard(recipe: ChartRecipe) {
  const roles = Object.fromEntries(
    Object.entries(recipe.data.roles).map(([name, role]) => {
      const how = [
        role.required ? 'required' : 'optional',
        ...(role.multiple ? ['several columns'] : []),
      ];
      return [name, `${role.types.join(' | ')}, ${how.join(', ')}: ${role.description}`];
    }),
  );
  const variants = Object.fromEntries(
    Object.entries(recipe.variants).map(([name, variant]) => [name, variant.whenToUse]),
  );
  return {
    id: recipe.id,
    shape: recipe.data.shape,
    accepts: recipe.data.accepts ?? [],
    roles,
    variants,
    whenToUse: recipe.whenToUse,
    whenNotToUse: recipe.whenNotToUse,
    pitfalls: recipe.pitfalls,
    limits: recipe.data.limits ?? {},
    option: recipe.option,
  };
}

/**
 * Creates the chart tools.
 *
 * @param charts - The chart recipes the agent is offered, by id.
 * @returns The tools.
 */
export function chartTools(charts: readonly string[] = chartRecipes.map((recipe) => recipe.id)) {
  const [firstId = 'trend.line', ...otherIds] = charts;
  return {
    chart_recipe: tool({
      description:
        'Read one chart recipe in full: the column each role takes, its variants, when not to use it, its pitfalls and its ECharts option template.',
      inputSchema: z.strictObject({ id: z.enum([firstId, ...otherIds]) }),
      execute: ({ id }) => {
        const recipe = chartRecipe(id);
        return recipe ? recipeCard(recipe) : { error: `No chart recipe "${id}".` };
      },
    }),
  };
}
