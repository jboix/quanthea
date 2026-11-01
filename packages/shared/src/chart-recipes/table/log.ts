import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { serviceLogs } from '../samples.ts';

/** Log lines: a time, a message and a tone by level, each opening to every column of its row. */
export const log: ChartRecipe = {
  id: 'table.log',
  title: 'Log',
  family: 'table',
  whenToUse: ['Log lines or events people read in order: errors of a service, audit entries.'],
  whenNotToUse: ['Counts of log lines over time: pick trend.line or comparison.bar.'],
  data: {
    shape: 'rows',
    roles: {
      time: role(['time'], 'When the line was written.'),
      message: role(['string', 'number'], 'The line, from one column or several.', {
        multiple: true,
      }),
    },
  },
  render: 'log',
  prepare: 'none',
  option: {},
  variants: {},
  pitfalls: [
    'options.level names the column of levels: error and worse show as bad, warn as a warning.',
    'At most 500 lines: sort by time and limit in the query. A viewer opens a line to read every column of its row.',
  ],
  sample: { roles: { time: 'time', message: ['service', 'message'] }, datasets: [serviceLogs] },
  queryHints: ['The rows to read, newest first, with every column worth opening.'],
};
