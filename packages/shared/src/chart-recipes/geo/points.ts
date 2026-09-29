import { role } from '../define.ts';
import type { ChartRecipe } from '../recipe.ts';
import { cityPoints } from '../samples.ts';

/** Places on the world map, sized by a value. */
export const points: ChartRecipe = {
  id: 'geo.points',
  title: 'Points on a map',
  family: 'geo',
  whenToUse: ['Values at places given by latitude and longitude: offices, sensors, stores.'],
  whenNotToUse: ['Values per country: use geo.choropleth.'],
  data: {
    shape: 'geo',
    roles: {
      lat: role(['number'], 'The latitude.'),
      lon: role(['number'], 'The longitude.'),
      value: role(['number'], 'The value the size shows.'),
      label: role(['string'], 'The name of the place.', { required: false }),
    },
  },
  render: 'echarts',
  prepare: 'points',
  option: {
    geo: {
      map: 'world',
      roam: false,
      top: 8,
      bottom: 8,
      itemStyle: { areaColor: '@divider', borderColor: '@surface', borderWidth: 0.5 },
      emphasis: { disabled: true },
    },
    series: [{ type: 'scatter', coordinateSystem: 'geo', itemStyle: { opacity: 0.8 } }],
    visualMap: { show: false, dimension: 2, inRange: { symbolSize: [6, 26] } },
    tooltip: { trigger: 'item' },
  },
  variants: {},
  pitfalls: [
    'Latitude comes first in most data, but the map reads longitude first; check the roles.',
  ],
  sample: {
    roles: { lat: 'lat', lon: 'lon', value: 'staff', label: 'office' },
    datasets: [cityPoints],
  },
  queryHints: ['One row per place with its latitude, longitude and value.'],
  requires: { map: 'world' },
};
