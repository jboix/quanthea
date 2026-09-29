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
  pitfalls: ['Tables show at most 500 rows; sort and limit in the query.'],
  sample: { roles: { columns: ['region', 'sales', 'target'] }, datasets: [regionSales] },
  queryHints: ['The rows and columns to list, sorted.'],
};
