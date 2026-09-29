import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { pageFlows } from '../samples.ts';

/** Links between things, laid out by force. */
export const graph: ChartRecipe = {
  id: 'flow.graph',
  title: 'Network graph',
  family: 'flow',
  whenToUse: ['Who connects to whom: service calls, dependencies, referrals.'],
  whenNotToUse: ['Amounts moving through ordered stages: use flow.sankey.', 'Over 100 nodes.'],
  data: {
    shape: 'graph',
    roles: {
      source: role(['string'], 'One end of the link.'),
      target: role(['string'], 'The other end.'),
      value: role(['number'], 'The weight of the link.'),
    },
  },
  render: 'echarts',
  prepare: 'graph',
  option: {
    series: [
      {
        type: 'graph',
        layout: 'force',
        force: { repulsion: 220, edgeLength: [60, 140] },
        roam: true,
        label: { show: true, position: 'right', color: '@ink' },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 6,
        lineStyle: { opacity: 0.5, width: 1.5, curveness: 0.1 },
        emphasis: { focus: 'adjacency' },
      },
    ],
    tooltip: { trigger: 'item' },
  },
  variants: {
    circle: {
      title: 'Circle',
      whenToUse: 'Few nodes, where a stable layout matters.',
      patch: { series: { layout: 'circular', force: null, label: { position: 'inside' } } },
    },
  },
  pitfalls: ['Force layouts move on every load; do not read meaning into positions.'],
  sample: { roles: { source: 'from', target: 'to', value: 'visits' }, datasets: [pageFlows] },
  queryHints: ['A count per pair of the two ends.'],
};
