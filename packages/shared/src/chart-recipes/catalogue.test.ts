import { describe, expect, test } from 'bun:test';
import { chartIndex, chartRecipes } from './catalogue.ts';
import { fillView } from './fill.ts';
import { mergePatch } from './merge.ts';
import { type ChartRecipe, chartRecipeSchema } from './recipe.ts';
import { themeTokens, valueTokens } from './tokens.ts';

/** Words that would tie a recipe to a data source. */
const sourceWords =
  /\b(postgres(ql)?|prometheus|promql|opensearch|elasticsearch|mysql|sqlite|sql|connector|select|credential|password)\b/i;

/**
 * Every `@` token in a value.
 *
 * @param value - Part of a recipe.
 * @returns The tokens.
 */
function tokensIn(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('@') ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(tokensIn);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(tokensIn);
  return [];
}

/**
 * The tokens a recipe may use: its roles, the theme's and the value tokens.
 *
 * @param recipe - The recipe.
 * @returns The allowed tokens.
 */
function allowedTokens(recipe: ChartRecipe): Set<string> {
  const roles = Object.keys(recipe.data.roles).map((name) => `@${name}`);
  return new Set<string>([...roles, ...themeTokens, ...valueTokens]);
}

describe('the chart catalogue', () => {
  test('has unique ids named after their family', () => {
    const ids = chartRecipes.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const recipe of chartRecipes) expect(recipe.id.split('.')[0]).toBe(recipe.family);
  });

  for (const recipe of chartRecipes) {
    describe(recipe.id, () => {
      test('fits the recipe schema', () => {
        const parsed = chartRecipeSchema.safeParse(recipe);
        expect(parsed.error?.issues ?? []).toEqual([]);
      });

      test('names no data source, no query language and no colour', () => {
        const text = JSON.stringify(recipe);
        expect(text.match(sourceWords)?.[0]).toBeUndefined();
        expect(text.match(/#[0-9a-f]{3,8}\b|rgba?\(/i)?.[0]).toBeUndefined();
      });

      test('is plain JSON, with only tokens it declares', () => {
        expect(JSON.parse(JSON.stringify(recipe))).toEqual(recipe);
        const allowed = allowedTokens(recipe);
        const unknown = tokensIn([recipe.option, recipe.variants]).filter(
          (token) => !allowed.has(token),
        );
        expect(unknown).toEqual([]);
      });

      test('draws its sample, of at most 50 rows, with every variant', () => {
        const [dataset] = recipe.sample.datasets;
        expect(dataset?.source.length ?? 0).toBeLessThanOrEqual(50);
        for (const variants of [[], ...Object.keys(recipe.variants).map((name) => [name])]) {
          const choice = { recipe: recipe.id, roles: recipe.sample.roles, variants };
          const filled = fillView(recipe, choice, ['A'], dataset);
          expect('problems' in filled ? filled.problems : []).toEqual([]);
        }
      });
    });
  }

  test('lists every recipe in one short line for the agent', () => {
    const index = chartIndex();
    expect(index.split('\n')).toHaveLength(chartRecipes.length);
    expect(index).toContain('trend.line (long): A number over time');
    expect(index.length).toBeLessThan(6000);
  });
});

describe('fillView', () => {
  const line = chartRecipes.find((recipe) => recipe.id === 'trend.line') as ChartRecipe;
  const [traffic] = line.sample.datasets;

  test('infers the roles not given and puts the unit’s formatter in place', () => {
    const filled = fillView(
      line,
      { recipe: line.id, unit: 'per-second', variants: ['stacked'] },
      ['A'],
      traffic,
    );
    if (!('view' in filled) || filled.view.kind !== 'chart') throw new Error('Expected a chart.');
    expect(filled.view.roles).toEqual({ x: 'time', series: 'service', y: ['requests'] });
    expect(filled.view.option.yAxis).toEqual({
      type: 'value',
      axisLabel: { formatter: { $fmt: 'si', unit: '/s' } },
    });
    expect(filled.view.recipe).toEqual({ id: 'trend.line', variants: ['stacked'] });
  });

  test('says which roles and variants are wrong', () => {
    const wrong = fillView(
      line,
      { recipe: line.id, roles: { x: 'service' }, variants: ['nope'] },
      ['A'],
      traffic,
    );
    expect(wrong).toEqual({ problems: ['trend.line has no variant nope.'] });
    const typed = fillView(line, { recipe: line.id, roles: { x: 'service' } }, ['A'], traffic);
    expect(typed).toEqual({ problems: ['The x role needs time; "service" is string.'] });
  });

  test('uses a variant’s own preparation', () => {
    const bar = chartRecipes.find((recipe) => recipe.id === 'comparison.bar') as ChartRecipe;
    const filled = fillView(
      bar,
      { recipe: bar.id, variants: ['percent'] },
      ['A'],
      bar.sample.datasets[0],
    );
    expect('view' in filled && filled.view.kind === 'chart' && filled.view.prepare).toBe('shares');
  });
});

describe('mergePatch', () => {
  test('merges objects, removes nulls, and patches every series with one object', () => {
    const base = { a: { b: 1, c: 2 }, series: [{ type: 'line' }, { type: 'bar' }] };
    expect(mergePatch(base, { a: { c: null, d: 3 }, series: { stack: 'x' } })).toEqual({
      a: { b: 1, d: 3 },
      series: [
        { type: 'line', stack: 'x' },
        { type: 'bar', stack: 'x' },
      ],
    });
    expect(mergePatch(base, { series: [{}, { type: 'line' }] })).toMatchObject({
      series: [{ type: 'line' }, { type: 'line' }],
    });
  });
});
