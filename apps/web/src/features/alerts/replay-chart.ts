/** Turns a replay into what the alert's chart draws, and into a line about how often it fired. */
import type { AlertListItem, AlertReplay } from '@quanthea/shared';
import type { AlertChartInput } from '../../charts/index.ts';
import { seriesName, valueText } from './words.ts';

/** The most series the chart draws: those that fired longest. */
export const maxChartSeries = 12;

/** A replay that ran. */
type Replayed = Extract<AlertReplay, { replayable: true }>;

/**
 * What the chart draws: the series that fired longest, the threshold and every firing period.
 *
 * @param replay - The replay.
 * @param alert - The alert, for its condition and format.
 * @returns The chart's input.
 */
export function chartInputOf(replay: Replayed, alert: AlertListItem): AlertChartInput {
  const series = [...replay.series]
    .sort((a, b) => b.firingMs - a.firingMs)
    .slice(0, maxChartSeries)
    .map((each) => ({ name: seriesName(each.labels), points: each.points }));
  const { condition, format } = alert;
  return {
    series,
    threshold: condition.kind === 'threshold' ? condition.value : null,
    firing: replay.series.flatMap((each) => each.firing.map(({ from, to }) => ({ from, to }))),
    format: (value) => valueText(value, format),
    from: replay.from,
    to: replay.to,
  };
}

/**
 * How long a span is, in words.
 *
 * @param ms - The span.
 * @returns Such as `54 min` or `3 h 10 min`.
 */
function spanWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/**
 * How often and how long the alert fired over the window, across its series.
 *
 * @param replay - The replay.
 * @param window - The window's name, such as `24 h`.
 * @returns Such as `Fired 2 times over the last 24 h, 54 min in all.`
 */
export function firingSummary(replay: Replayed, window: string): string {
  const firings = replay.series.reduce((sum, each) => sum + each.firings, 0);
  if (firings === 0) return `Did not fire over the last ${window}.`;
  const total = replay.series.reduce((sum, each) => sum + each.firingMs, 0);
  const times = firings === 1 ? 'once' : `${firings} times`;
  return `Fired ${times} over the last ${window}, ${spanWords(total)} in all.`;
}

/**
 * How often and how long the alert would have fired over the window with changes not saved.
 *
 * @param tracks - How each series would have behaved with the changes.
 * @param window - The window's name, such as `24 h`.
 * @returns Such as `With the changes, it would have fired once over the last 24 h, 12 min in all.`
 */
export function changedSummary(
  tracks: readonly { readonly firings: number; readonly firingMs: number }[],
  window: string,
): string {
  const firings = tracks.reduce((sum, each) => sum + each.firings, 0);
  if (firings === 0) return `With the changes, it would not have fired over the last ${window}.`;
  const total = tracks.reduce((sum, each) => sum + each.firingMs, 0);
  const times = firings === 1 ? 'once' : `${firings} times`;
  return `With the changes, it would have fired ${times} over the last ${window}, ${spanWords(total)} in all.`;
}
