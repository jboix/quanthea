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
  pitfalls: [
    'Say in the title what the number covers: "now", "today", "over the range".',
    'options.mappings: [{ "match", "text"?, "tone"? }], the first match wins. match is { "value": 0 }, { "null": true } or a range of numbers { "from"?, "to"? }, from included, to excluded.',
    'Thresholds colour the number: [{ "match": { "to": 2 }, "tone": "good" }, { "match": { "from": 2 }, "tone": "bad" }]. options.toneAs: "background" tints behind the number instead.',
    'A text replaces the number: { "match": { "null": true }, "text": "0" } shows 0 when the query returns no value. Keep it short.',
  ],
  sample: { roles: { value: 'signups' }, datasets: [dailyCounts] },
  queryHints: ['One value, or a series whose last or total is the number.'],
};
