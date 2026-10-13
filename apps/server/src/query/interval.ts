/**
 * The interval a query's time buckets follow. A caller that cuts its charts into even intervals,
 * such as a report's run, gives one; without it each language picks its own from the time range.
 */
import { defaultChartInterval } from '@quanthea/shared';
import type { TimeRange } from '../connectors/_shared/index.ts';
import { QueryError } from './query-error.ts';

/**
 * Parses a duration such as `15s`, `1m` or `1h`.
 *
 * @param text - The duration.
 * @returns Seconds, or `undefined` when it is not a simple duration.
 */
export function parseDuration(text: string): number | undefined {
  const match = /^(\d+)([smhd])$/.exec(text);
  if (!match) return undefined;
  const unit = { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}

/**
 * The seconds of a chosen interval, checked again here so nothing but a duration is bound.
 *
 * @param interval - The interval, such as `1h`, if one was chosen.
 * @returns Its seconds, or `undefined` when none was chosen.
 * @throws {QueryError} `invalid` for anything that is not a duration above zero.
 */
export function chosenSeconds(interval: string | undefined): number | undefined {
  if (interval === undefined) return undefined;
  const seconds = /^\d{1,5}[smhd]$/.test(interval) ? parseDuration(interval) : undefined;
  if (seconds === undefined || seconds === 0)
    throw new QueryError('invalid', 'The interval is a duration such as 5m, 1h or 1d.');
  return seconds;
}

/**
 * The interval a SQL query's `:__interval` binds to: the chosen one, else the one of the closed
 * list that suits the time range, such as `1h` over a week.
 *
 * @param timeRange - The time range.
 * @param interval - The interval, if one was chosen.
 * @returns The interval as a duration, such as `10m`.
 * @throws {QueryError} `invalid` for a chosen interval that is not a duration.
 */
export function sqlInterval(timeRange: TimeRange, interval: string | undefined): string {
  if (chosenSeconds(interval) !== undefined) return interval as string;
  return defaultChartInterval(timeRange.to.getTime() - timeRange.from.getTime());
}
