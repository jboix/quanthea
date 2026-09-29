/**
 * The maps charts may draw, registered with ECharts the first time a chart needs one. The world
 * map is a file of this repository, so no map is ever fetched from elsewhere.
 */
import { getMap, registerMap } from 'echarts/core';
import { isObject, type Loose } from './loose.ts';

/**
 * The maps an option draws: on map series and on the geo component.
 *
 * @param option - The option.
 * @returns The map names.
 */
export function mapsOf(option: Loose): string[] {
  const series = [option.series ?? []].flat().filter(isObject);
  const names = [
    ...series.map((each) => each.map),
    isObject(option.geo) ? option.geo.map : undefined,
  ];
  return [...new Set(names.filter((name): name is string => typeof name === 'string'))];
}

/**
 * Registers the world map from its GeoJSON text.
 *
 * @param text - The GeoJSON.
 */
export function registerWorld(text: string): void {
  registerMap('world', JSON.parse(text));
}

/**
 * Makes sure the maps an option draws are registered, loading the world map when first needed.
 *
 * @param option - The option.
 * @returns When the maps are ready.
 */
export async function ensureMaps(option: Loose): Promise<void> {
  if (!mapsOf(option).includes('world') || getMap('world')) return;
  const { default: text } = await import('./maps/world.geojson?raw');
  registerWorld(text);
}
