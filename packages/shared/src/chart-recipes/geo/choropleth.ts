import { bottomVisualMap, role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { countryValues } from '../samples.ts';

/** Countries coloured by a value. */
export const choropleth: ChartRecipe = {
  id: 'geo.choropleth',
  title: 'World map',
  family: 'geo',
  whenToUse: ['A value per country, where where matters: customers, traffic, revenue.'],
  whenNotToUse: ['Few countries, or exact comparisons: use comparison.ranked-bar.'],
  data: {
    shape: 'geo',
    roles: {
      region: role(['string'], 'The country, named in English as on the map.'),
      value: role(['number'], 'Its value.'),
    },
  },
  render: 'echarts',
  prepare: 'regions',
  option: {
    series: [
      {
        type: 'map',
        map: 'world',
        roam: false,
        top: 8,
        bottom: 40,
        itemStyle: { areaColor: '@divider', borderColor: '@surface', borderWidth: 0.5 },
        emphasis: { label: { show: false }, itemStyle: { areaColor: '@palette.1' } },
      },
    ],
    visualMap: bottomVisualMap,
    tooltip: { trigger: 'item', valueFormatter: '@format' },
  },
  variants: {},
  pitfalls: [
    'Countries named otherwise than on the map stay grey: "United States of America", not "US".',
    'Big countries look important whatever their value; compare with a ranked bar too.',
  ],
  sample: { roles: { region: 'country', value: 'customers' }, datasets: [countryValues] },
  queryHints: ['A total per country name.'],
  requires: { map: 'world' },
};
