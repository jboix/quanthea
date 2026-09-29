import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { dailyCounts } from '../samples.ts';

/** One big number. */
export const stat: ChartRecipe = {
  id: 'kpi.stat',
  title: 'Number',
  family: 'kpi',
  whenToUse: ['One number people check at a glance: error rate now, orders today.'],
  whenNotToUse: ['When the trend matters as much: use kpi.big-number.'],
  data: {
    shape: 'single',
    accepts: ['long', 'wide'],
    roles: { value: role(['number'], 'The value; a column of several rows is reduced.') },
  },
  render: 'stat',
  prepare: 'none',
  option: { reduce: 'last', format: '@format' },
  variants: {
    sum: { title: 'Total', whenToUse: 'The total over the range.', patch: { reduce: 'sum' } },
    max: {
      title: 'Peak',
      whenToUse: 'The highest value over the range.',
      patch: { reduce: 'max' },
    },
    mean: { title: 'Average', whenToUse: 'The average over the range.', patch: { reduce: 'mean' } },
  },
  pitfalls: ['Say in the title what the number covers: "now", "today", "over the range".'],
  sample: { roles: { value: 'signups' }, datasets: [dailyCounts] },
  queryHints: ['One value, or a series whose last or total is the number.'],
};
