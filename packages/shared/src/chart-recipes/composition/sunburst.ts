import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { budgetTree } from '../samples.ts';

/** A hierarchy as rings, the root in the middle. */
export const sunburst: ChartRecipe = {
  id: 'composition.sunburst',
  title: 'Sunburst',
  family: 'composition',
  whenToUse: ['A hierarchy of two or three levels where the path from the root matters.'],
  whenNotToUse: ['Comparing leaf sizes: use composition.treemap, whose areas read better.'],
  data: {
    shape: 'hierarchical',
    roles: {
      levels: role(['string'], 'The level columns, from the centre out.', { multiple: true }),
      value: role(['number'], 'The size of each leaf.'),
    },
  },
  render: 'echarts',
  prepare: 'tree',
  option: {
    series: [
      {
        type: 'sunburst',
        radius: ['12%', '92%'],
        nodeClick: false,
        label: { rotate: 'radial', minAngle: 8 },
        itemStyle: { borderColor: '@surface', borderWidth: 1 },
      },
    ],
    tooltip: { trigger: 'item', valueFormatter: '@format' },
  },
  variants: {},
  pitfalls: ['Past three levels the outer rings become unreadable.'],
  sample: { roles: { levels: ['department', 'team'], value: 'budget' }, datasets: [budgetTree] },
  queryHints: ['A total per leaf, with a column for each level above it.'],
};
