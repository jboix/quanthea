import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { pageFlows } from '../samples.ts';

/** Flows between stages, as bands whose widths are the amounts. */
export const sankey: ChartRecipe = {
  id: 'flow.sankey',
  title: 'Sankey',
  family: 'flow',
  whenToUse: ['How amounts flow between stages: visits between pages, money between accounts.'],
  whenNotToUse: ['Flows that loop back: a sankey needs a direction; use flow.graph.'],
  data: {
    shape: 'graph',
    roles: {
      source: role(['string'], 'Where the flow starts.'),
      target: role(['string'], 'Where it goes.'),
      value: role(['number'], 'How much flows.'),
    },
  },
  render: 'echarts',
  prepare: 'graph',
  option: {
    series: [
      {
        type: 'sankey',
        left: 8,
        right: 80,
        nodeGap: 10,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', opacity: 0.35 },
        label: { color: '@ink' },
      },
    ],
    tooltip: { trigger: 'item', valueFormatter: '@format' },
  },
  variants: {
    vertical: {
      title: 'Top to bottom',
      whenToUse: 'Many stages in a narrow panel.',
      patch: {
        series: {
          orient: 'vertical',
          left: 8,
          right: 8,
          bottom: 24,
          label: { position: 'bottom' },
        },
      },
    },
  },
  pitfalls: ['A cycle breaks the chart; links back to an earlier stage are dropped.'],
  sample: { roles: { source: 'from', target: 'to', value: 'visits' }, datasets: [pageFlows] },
  queryHints: ['A total per pair of source and target.'],
};
