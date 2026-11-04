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
  variants: {
    record: {
      title: 'Record',
      whenToUse:
        'The fields of one row as labelled values, text included: a session, a device, an order. The query returns that row; only the first shows.',
      patch: { record: true },
    },
    'compact-record': {
      title: 'Compact record',
      whenToUse:
        'One row as a number: its first column as the headline, such as an amount, the others on a line below. The latest order, the last deploy. It sits among the numbers.',
      patch: { record: true, compact: true },
    },
  },
  pitfalls: [
    'At most 500 rows: sort and limit in the query. Viewers sort, filter and page; options.pageSize: 5 to 100 rows, default 20. "display": "image" shows https addresses as images.',
    'options.columns changes columns by "field": [{ "field", "label"?, "format"?, "align"?, "mappings"?, "toneAs"?, "width"?, "link"?, "display"? }], only those to change. width: narrow, medium, wide.',
    'link: { "dashboard": id, "variables"?: { "host": { "column": "host" } } } opens a pinned dashboard, each variable a { "column" }, { "variable" } or text. { "url": "https://…/{value}" } opens a page.',
    'mappings: [{ "match", "text"?, "tone"? }], the first match wins. match is { "value": "error" }, { "null": true } or a range of numbers { "from"?, "to"? }, from included, to excluded.',
    'Thresholds: [{ "match": { "to": 2 }, "tone": "good" }, { "match": { "from": 2 }, "tone": "bad" }]. A match reads the value before the format. "toneAs": "background" tints the cell.',
  ],
  sample: { roles: { columns: ['region', 'sales', 'target'] }, datasets: [regionSales] },
  queryHints: [
    'The rows and columns to list, sorted.',
    'One unit per column, never amounts and counts in one. A money column says so in its format: { "$fmt": "currency", "code": "CHF" }.',
  ],
};
