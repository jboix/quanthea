import { bottomVisualMap, role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { dailyCounts } from '../samples.ts';

/** A value per day, laid on a calendar. */
export const calendarHeatmap: ChartRecipe = {
  id: 'distribution.calendar-heatmap',
  title: 'Calendar heatmap',
  family: 'distribution',
  whenToUse: ['A daily value over weeks or months, where weekdays and weekends matter.'],
  whenNotToUse: [
    'Fewer than two weeks: use trend.line.',
    'Values per hour: use relationship.heatmap.',
  ],
  data: {
    shape: 'long',
    roles: {
      time: role(['time'], 'The day.'),
      value: role(['number'], 'The value of the day.'),
    },
  },
  render: 'echarts',
  prepare: 'calendar',
  option: {
    calendar: {
      top: 24,
      left: 36,
      right: 12,
      cellSize: ['auto', 14],
      dayLabel: { firstDay: 1, nameMap: 'en' },
      yearLabel: { show: false },
      itemStyle: { borderColor: '@surface', borderWidth: 2 },
      splitLine: { show: false },
    },
    visualMap: bottomVisualMap,
    series: [{ type: 'heatmap', coordinateSystem: 'calendar' }],
    tooltip: { trigger: 'item' },
  },
  variants: {},
  pitfalls: ['Days with no row look empty, not zero; send zeros when a day had none.'],
  sample: { roles: { time: 'day', value: 'signups' }, datasets: [dailyCounts] },
  queryHints: ['A total per day.'],
};
