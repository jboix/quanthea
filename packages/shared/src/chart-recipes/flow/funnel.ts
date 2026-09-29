import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { funnelStages } from '../samples.ts';

/** How many remain at each stage of a process. */
export const funnel: ChartRecipe = {
  id: 'flow.funnel',
  title: 'Funnel',
  family: 'flow',
  whenToUse: ['Drop-off through the ordered stages of a process: sign-up, activation, purchase.'],
  whenNotToUse: ['Stages that are not subsets of each other: use comparison.bar.'],
  data: {
    shape: 'long',
    roles: {
      category: role(['string'], 'The stage.'),
      value: role(['number'], 'How many reached it.'),
    },
    limits: { maxCategories: 8 },
  },
  render: 'echarts',
  prepare: 'items',
  option: {
    series: [
      {
        type: 'funnel',
        sort: 'descending',
        gap: 2,
        left: '10%',
        width: '80%',
        label: { position: 'inside', formatter: '{b}' },
        encode: { itemName: '@category', value: '@value' },
      },
    ],
    tooltip: { trigger: 'item', valueFormatter: '@format' },
  },
  variants: {},
  pitfalls: ['Each stage should count people who also passed the one before.'],
  sample: { roles: { category: 'stage', value: 'people' }, datasets: [funnelStages] },
  queryHints: ['A count of distinct people per stage reached.'],
};
