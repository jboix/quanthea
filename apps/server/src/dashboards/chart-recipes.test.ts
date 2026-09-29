import { describe, expect, test } from 'bun:test';
import { chartRecipes, fillView } from '@querent/shared';
import { checkOption } from './check-option.ts';

describe('the chart recipes', () => {
  for (const recipe of chartRecipes.filter((each) => each.render === 'echarts')) {
    test(`${recipe.id} fills options the spec allows, with every variant`, () => {
      for (const variants of [[], ...Object.keys(recipe.variants).map((name) => [name])]) {
        const choice = { recipe: recipe.id, roles: recipe.sample.roles, variants };
        const filled = fillView(recipe, choice, ['A'], recipe.sample.datasets[0]);
        if (!('view' in filled) || filled.view.kind !== 'chart')
          throw new Error('Expected a chart.');
        expect(checkOption(filled.view.option, 'option')).toEqual([]);
      }
    });
  }
});
