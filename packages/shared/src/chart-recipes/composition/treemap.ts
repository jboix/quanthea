import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { budgetTree } from '../samples.ts';

/** A hierarchy as nested rectangles sized by value. */
export const treemap: ChartRecipe = {
  id: 'composition.treemap',
  title: 'Treemap',
  family: 'composition',
  whenToUse: ['Shares within a hierarchy: budget by department and team, disk by folder.'],
  whenNotToUse: ['One level with few parts: use composition.pie or comparison.ranked-bar.'],
  data: {
    shape: 'hierarchical',
    roles: {
      levels: role(['string'], 'The level columns, from the top down.', { multiple: true }),
      value: role(['number'], 'The size of each leaf.'),
    },
  },
  render: 'echarts',
  prepare: 'tree',
  option: {
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
        label: { show: true, formatter: '{b}' },
        upperLabel: { show: true, height: 18 },
        itemStyle: { borderColor: '@surface', borderWidth: 1, gapWidth: 1 },
        levels: [{ itemStyle: { borderWidth: 0, gapWidth: 2 } }, { colorSaturation: [0.35, 0.6] }],
      },
    ],
    tooltip: { trigger: 'item', valueFormatter: '@format' },
  },
  variants: {},
  pitfalls: ['Only sizes that add up belong in a treemap; never averages.'],
  sample: { roles: { levels: ['department', 'team'], value: 'budget' }, datasets: [budgetTree] },
  queryHints: ['A total per leaf, with a column for each level above it.'],
};
