/** ECharts objects as the adapter handles them: loosely typed JSON, plus functions and data. */

/** An ECharts object, loosely typed: the spec's JSON plus functions and data from the adapter. */
export type Loose = Record<string, unknown>;

/**
 * Whether a value is a plain object.
 *
 * @param value - Any value.
 * @returns Whether it is an object that is not an array.
 */
export function isObject(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
