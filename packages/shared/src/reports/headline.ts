/**
 * A report's headline numbers: each summary panel's stat, read from a run's frozen results as the
 * stat panel reads it, with its change against the comparison period. The change of a percentage
 * is in points (`▼ 0.4 pt`); any other number changes by a share of the one before (`▲ 6.2%`).
 * Our code writes every word; the spec only names the panels and their formats.
 */
import { z } from 'zod';
import type { QueryOutcome } from '../api/panels.ts';
import { reduceResult } from '../dataset/stat.ts';
import { createFormatter } from '../formatters/format.ts';
import type { Formatter } from '../formatters/schema.ts';
import type { StatView } from '../spec/views.ts';

/** Validates how a number moved since the period before. */
export const headlineChangeSchema = z.object({
  /** Up, down, or the same. */
  direction: z.enum(['up', 'down', 'flat']),
  /** Such as `▲ 6.2%`, `▼ 0.4 pt` or `no change`. */
  text: z.string(),
});

/** How a number moved since the period before. */
export type HeadlineChange = z.infer<typeof headlineChangeSchema>;

/** Validates one headline number of a run. */
export const headlineSchema = z.object({
  /** The panel it comes from. */
  panelId: z.string(),
  /** The panel's title. */
  title: z.string(),
  /** The number, or `null` when the result held none. */
  value: z.number().nullable(),
  /** The number, formatted as the panel formats it; a dash when there is none. */
  text: z.string(),
  /** The number over the comparison period, or `null`. */
  previous: z.number().nullable(),
  /** That number, formatted; `null` without a comparison. */
  previousText: z.string().nullable(),
  /** How it moved; `null` without a comparison or a number to compare. */
  change: headlineChangeSchema.nullable(),
});

/** One headline number of a run. */
export type Headline = z.infer<typeof headlineSchema>;

/** A stat panel, as a headline reads it. */
export interface HeadlinePanel {
  /** The panel id. */
  readonly id: string;
  /** Its title. */
  readonly title: string;
  /** Its stat view. */
  readonly view: StatView;
}

/** What is shown for a missing number. */
const missing = '–';

/**
 * How a percentage formatter scales a value to percent.
 *
 * @param format - The panel's format.
 * @returns 100 for a ratio, 1 for a value already in percent, or `null` for any other format.
 */
function percentScale(format: Formatter): number | null {
  if (typeof format === 'string' || format.$fmt !== 'percent') return null;
  return format.input === 'percent' ? 1 : 100;
}

/**
 * Writes a change, rounded to one decimal, with its direction.
 *
 * @param amount - The change, as a percentage or in points.
 * @param unit - `%` or ` pt`.
 * @returns The change.
 */
function changeText(amount: number, unit: string): HeadlineChange {
  const rounded = Math.round(Math.abs(amount) * 10) / 10;
  if (rounded === 0) return { direction: 'flat', text: 'no change' };
  const digits = new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(rounded);
  return amount > 0
    ? { direction: 'up', text: `▲ ${digits}${unit}` }
    : { direction: 'down', text: `▼ ${digits}${unit}` };
}

/**
 * How a number moved from the one before: in points for a percentage, else as a share.
 *
 * @param value - The number now.
 * @param previous - The number before.
 * @param format - The panel's format.
 * @returns The change, or `null` when there is nothing to compare, or a share of zero.
 */
export function changeOf(
  value: number | null,
  previous: number | null,
  format: Formatter,
): HeadlineChange | null {
  if (value === null || previous === null) return null;
  const scale = percentScale(format);
  if (scale !== null) return changeText((value - previous) * scale, ' pt');
  if (previous === 0) return value === 0 ? changeText(0, '%') : null;
  return changeText(((value - previous) / Math.abs(previous)) * 100, '%');
}

/**
 * Reads a stat panel's number from its results.
 *
 * @param view - The stat view.
 * @param queries - The panel's query outcomes.
 * @returns The number, or `null`.
 */
function statOf(view: StatView, queries: readonly QueryOutcome[]): number | null {
  return reduceResult(queries, view.ref, view.reduce, view.field) ?? null;
}

/**
 * Reads a headline: the stat over the period, over the comparison period, and the change.
 *
 * @param panel - The stat panel.
 * @param queries - Its results over the period.
 * @param before - Its results over the comparison period, or `null` without one.
 * @param timeZone - The report's time zone, for dates.
 * @returns The headline.
 */
export function headlineOf(
  panel: HeadlinePanel,
  queries: readonly QueryOutcome[],
  before: readonly QueryOutcome[] | null,
  timeZone: string,
): Headline {
  const format = createFormatter(panel.view.format, { timeZone });
  const value = statOf(panel.view, queries);
  const previous = before === null ? null : statOf(panel.view, before);
  const previousText = previous === null ? missing : format(previous);
  return {
    panelId: panel.id,
    title: panel.title,
    value,
    text: value === null ? missing : format(value),
    previous,
    previousText: before === null ? null : previousText,
    change: changeOf(value, previous, panel.view.format),
  };
}
