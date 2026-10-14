import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { regionSales } from '../samples.ts';

/** Rows as they come, in a table. */
export const rows: ChartRecipe = {
  id: 'table.rows',
  title: 'Table',
  family: 'table',
  whenToUse: ['Lists people read or search: latest errors, orders, hosts with details.'],
  whenNotToUse: ['A pattern people should see at a glance: pick a chart.'],
  data: {
    shape: 'rows',
    roles: {
      columns: role(['string', 'number', 'time', 'boolean'], 'The columns to show, in order.', {
        multiple: true,
      }),
    },
  },
  render: 'table',
  prepare: 'none',
  option: {},
  variants: {},
  pitfalls: [
    'At most 500 rows: sort and limit in the query. Viewers sort by a click, filter and page: options.pageSize sets the rows of a page, 5 to 100, 20 when left out.',
    'options.columns changes columns by "field": [{ "field", "label"?, "format"?, "align"?, "mappings"?, "toneAs"? }], only those to change. The order stays that of roles.columns.',
    'mappings: [{ "match", "text"?, "tone"? }], the first match wins. match is { "value": "error" }, { "null": true } or a range of numbers { "from"?, "to"? }, from included, to excluded.',
    'Thresholds are ranges: [{ "match": { "to": 2 }, "tone": "good" }, { "match": { "from": 2, "to": 4 }, "tone": "warning" }, { "match": { "from": 4 }, "tone": "bad" }].',
    'A match reads the value as the query returns it, before the format. "toneAs": "background" tints the cell; left out, the tone colours the text.',
  ],
  sample: { roles: { columns: ['region', 'sales', 'target'] }, datasets: [regionSales] },
  queryHints: ['The rows and columns to list, sorted.'],
};
