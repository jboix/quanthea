/** Shorthands the recipe files use to declare their roles and shared option parts. */
import type { DimensionType } from '../dataset/contract.ts';
import type { RoleSpec } from './recipe.ts';

/**
 * A role.
 *
 * @param types - The column types it takes.
 * @param description - What it is, for the agent.
 * @param options - Whether it is required (by default) and whether it takes several columns.
 * @param options.required - Whether it must have a column.
 * @param options.multiple - Whether it takes several columns.
 * @returns The role.
 */
export function role(
  types: readonly DimensionType[],
  description: string,
  options: { required?: boolean; multiple?: boolean } = {},
): RoleSpec {
  const { required = true, multiple } = options;
  return { types: [...types], required, description, ...(multiple ? { multiple } : {}) };
}

/** Zoom by wheel and by a slider under the chart, for long ranges. */
export const zoomPatch = {
  dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 4 }],
};

/** A colour scale from a light tint to the accent, from the theme. */
export const colourScale = { color: ['@scale.low', '@scale.high'] };

/** A horizontal colour legend under the chart, whose range follows the data. */
export const bottomVisualMap = {
  type: 'continuous',
  orient: 'horizontal',
  left: 'center',
  bottom: 0,
  itemHeight: 120,
  itemWidth: 10,
  calculable: false,
  inRange: colourScale,
};
