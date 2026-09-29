import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { trafficLong } from '../samples.ts';

/** Six and eight hours into the samples: a fake incident window. */
const [incidentStart, incidentEnd] = [Date.UTC(2026, 0, 5, 6), Date.UTC(2026, 0, 5, 8)];

/** A line with a threshold and a marked window. */
export const thresholds: ChartRecipe = {
  id: 'trend.thresholds',
  title: 'Line with thresholds',
  family: 'trend',
  whenToUse: [
    'A number over time against a limit, a target or an SLO.',
    'Showing when an incident or a maintenance window happened.',
  ],
  whenNotToUse: ['Deploys and other events from data: use the dashboard markers.'],
  data: {
    shape: 'long',
    accepts: ['wide'],
    roles: {
      x: role(['time'], 'The time.'),
      series: role(['string'], 'What splits the lines.', { required: false }),
      y: role(['number'], 'The values.', { multiple: true }),
    },
    limits: { maxSeries: 5 },
  },
  render: 'echarts',
  prepare: 'cartesian',
  option: {
    xAxis: { type: 'time' },
    yAxis: { type: 'value', axisLabel: { formatter: '@format' } },
    series: [
      {
        type: 'line',
        showSymbol: false,
        encode: { x: '@x', y: '@y' },
        markLine: {
          symbol: ['none', 'none'],
          silent: true,
          lineStyle: { type: 'dashed', color: '@ink' },
          label: { formatter: '{b}', position: 'insideEndTop' },
          data: [{ name: 'Limit', yAxis: 180 }],
        },
        markArea: {
          silent: true,
          itemStyle: { color: '@scale.low', opacity: 0.6 },
          label: { position: 'insideTop' },
          data: [[{ name: 'Incident', xAxis: incidentStart }, { xAxis: incidentEnd }]],
        },
      },
    ],
    tooltip: { trigger: 'axis', valueFormatter: '@format' },
    legend: {},
  },
  variants: {
    band: {
      title: 'Target band',
      whenToUse: 'A healthy range rather than one limit.',
      patch: {
        series: {
          markLine: null,
          markArea: {
            data: [[{ name: 'Target', yAxis: 60 }, { yAxis: 140 }]],
          },
        },
      },
    },
  },
  pitfalls: [
    'Set the limit and the window from the question or the data; the sample values mean nothing.',
    'A limit far outside the data squashes the lines: leave it out or say it in words.',
  ],
  sample: { roles: { x: 'time', series: 'service', y: 'requests' }, datasets: [trafficLong] },
  queryHints: ['The same data as a line; the limit comes from the question, not a query.'],
};
