/**
 * Fills a recipe into a panel view: the variants and the agent's changes merged into the option,
 * the unit's formatter put where the recipe asks for it, and the columns of each role chosen. The
 * view keeps everything it needs, so it draws the same whatever the catalogue becomes.
 */
import type { Dataset } from '../dataset/contract.ts';
import type { View } from '../spec/views.ts';
import { type ChartUnit, formatToken, unitFormatter } from './conventions.ts';
import { isJsonObject, type Json, type JsonObject, mergePatch } from './merge.ts';
import type { PrepareKind } from './prepare.ts';
import type { ChartRecipe } from './recipe.ts';
import { inferRoles, type RoleColumns, roleProblems } from './roles.ts';

/** What the agent picks for a panel: a recipe, its variants, its columns and its unit. */
export interface ChartChoice {
  /** The recipe's id. */
  readonly recipe: string;
  /** The variants to apply, in order. */
  readonly variants?: readonly string[] | undefined;
  /** The columns of each role; the rest are inferred. */
  readonly roles?: RoleColumns | undefined;
  /** How values read. */
  readonly unit?: ChartUnit | undefined;
  /** Changes to the option, merged last. */
  readonly overrides?: JsonObject | undefined;
}

/**
 * Replaces every `@format` token with a formatter.
 *
 * @param value - Part of an option.
 * @param formatter - The formatter.
 * @returns The value with the tokens replaced.
 */
function withFormatter(value: Json, formatter: JsonObject): Json {
  if (value === formatToken) return formatter;
  if (Array.isArray(value)) return value.map((item) => withFormatter(item, formatter));
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, withFormatter(child, formatter)]),
  );
}

/**
 * The option of a recipe with variants, changes and the unit's formatter.
 *
 * @param recipe - The recipe.
 * @param choice - The variants, the changes and the unit.
 * @returns The option, or the variants the recipe does not have.
 */
export function fillOption(recipe: ChartRecipe, choice: Omit<ChartChoice, 'recipe' | 'roles'>) {
  const variants = choice.variants ?? [];
  const unknown = variants.filter((name) => !(name in recipe.variants));
  if (unknown.length > 0)
    return { problems: [`${recipe.id} has no variant ${unknown.join(', ')}.`] };
  const patched = variants.reduce<Json>(
    (option, name) => mergePatch(option, recipe.variants[name]?.patch ?? {}),
    recipe.option,
  );
  const changed = choice.overrides ? mergePatch(patched, choice.overrides) : patched;
  const formatter = unitFormatter(choice.unit ?? 'number') as JsonObject;
  return { option: withFormatter(changed, formatter) as JsonObject };
}

/**
 * The view of a stat or table recipe: quanthea's own views, configured by the option.
 *
 * @param recipe - The recipe.
 * @param option - The filled option.
 * @param roles - The columns of each role.
 * @param ref - The query the view reads.
 * @returns The view.
 */
function ownView(recipe: ChartRecipe, option: JsonObject, roles: RoleColumns, ref: string): View {
  if (recipe.render === 'table') {
    const names = [roles.columns ?? []].flat();
    return { kind: 'table', ref, columns: names.map((field) => ({ field })), ...option } as View;
  }
  const { format, ...rest } = option;
  const field = typeof roles.value === 'string' ? roles.value : undefined;
  return {
    kind: 'stat',
    ref,
    reduce: 'last',
    format,
    ...(field ? { field } : {}),
    ...rest,
  } as View;
}

/**
 * The chart view of an ECharts recipe.
 *
 * @param recipe - The recipe.
 * @param choice - What the agent picked.
 * @param option - The filled option.
 * @param roles - The columns of each role.
 * @param refs - The queries the view reads.
 * @returns The view.
 */
function chartView(
  recipe: ChartRecipe,
  choice: ChartChoice,
  option: JsonObject,
  roles: RoleColumns,
  refs: readonly string[],
): View {
  const variants = choice.variants ?? [];
  const prepare = variants.reduce<PrepareKind>(
    (kind, name) => recipe.variants[name]?.prepare ?? kind,
    recipe.prepare,
  );
  const limit = recipe.data.limits?.maxCategories;
  return {
    kind: 'chart',
    recipe: { id: recipe.id, variants: [...variants] },
    prepare,
    roles,
    ...(limit ? { limit } : {}),
    option,
    datasets: refs.map((ref) => ({ ref })),
  };
}

/**
 * Fills a recipe into a panel view.
 *
 * @param recipe - The recipe.
 * @param choice - What the agent picked.
 * @param refs - The queries the view reads, the first being the main one.
 * @param dataset - The main query's data, when known, to infer and check the roles.
 * @returns The view, or what is wrong.
 */
export function fillView(
  recipe: ChartRecipe,
  choice: ChartChoice,
  refs: readonly string[],
  dataset?: Dataset,
): { view: View } | { problems: string[] } {
  const filled = fillOption(recipe, choice);
  if (!filled.option) return { problems: filled.problems };
  const asked = choice.roles ?? {};
  const roles = dataset ? inferRoles(recipe.data.roles, dataset, asked) : asked;
  const problems = dataset ? roleProblems(recipe.data.roles, dataset, roles) : [];
  if (problems.length > 0) return { problems };
  if (recipe.render !== 'echarts')
    return { view: ownView(recipe, filled.option, roles, refs[0] ?? 'A') };
  return { view: chartView(recipe, choice, filled.option, roles, refs) };
}
