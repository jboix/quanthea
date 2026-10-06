/**
 * What every recipe follows: values read through named formatters picked by unit, colours come
 * from the theme and never from a recipe, and the adapter owns the dataset, the grid, the fonts,
 * the animation and how empty results read.
 */
import type { NamedFormatter } from '../formatters/schema.ts';

/** How a chart's values read; percent expects a ratio from 0 to 1. */
export const chartUnits = [
  'number',
  'percent',
  'bytes',
  'seconds',
  'milliseconds',
  'per-second',
  'EUR',
  'USD',
  'CHF',
  'GBP',
] as const;

/** A unit. */
export type ChartUnit = (typeof chartUnits)[number];

/** The formatter of each unit. */
const unitFormatters: Readonly<Record<ChartUnit, NamedFormatter>> = {
  number: { $fmt: 'number', compact: true },
  percent: { $fmt: 'percent', decimals: 1 },
  bytes: { $fmt: 'bytes', base: 1024 },
  seconds: { $fmt: 'duration', unit: 's' },
  milliseconds: { $fmt: 'duration', unit: 'ms' },
  'per-second': { $fmt: 'si', unit: '/s' },
  EUR: { $fmt: 'currency', code: 'EUR' },
  USD: { $fmt: 'currency', code: 'USD' },
  CHF: { $fmt: 'currency', code: 'CHF' },
  GBP: { $fmt: 'currency', code: 'GBP' },
};

/**
 * The formatter of a unit.
 *
 * @param unit - The unit.
 * @returns The named formatter.
 */
export function unitFormatter(unit: ChartUnit): NamedFormatter {
  return unitFormatters[unit];
}

/** The token a recipe puts where the unit's formatter goes, such as an axis label's `formatter`. */
export const formatToken = '@format';
