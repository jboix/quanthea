/**
 * How alerts read: their condition, values, series, times and state, in the words the list and
 * the alert page share.
 */
import {
  type AlertListItem,
  type AlertState,
  createFormatter,
  durationMs,
  type NamedFormatter,
} from '@quanthea/shared';

/** A minute, an hour and a day, in milliseconds. */
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** How each state reads after a series name, as in "checkout firing". */
export const stateWords: Readonly<Record<AlertState, string>> = {
  ok: 'ok',
  pending: 'pending',
  firing: 'firing',
  no_data: 'no data',
  error: 'query failing',
};

/**
 * A value as the alert's format writes it, or with four significant digits.
 *
 * @param value - The value, or `null`.
 * @param format - The alert's value format, if any.
 * @returns Such as `3.4%`, or a dash for no value.
 */
export function valueText(value: number | null, format: NamedFormatter | null): string {
  if (value === null) return '–';
  if (format) return createFormatter(format)(value);
  return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 }).format(value);
}

/**
 * The condition in words.
 *
 * @param condition - The condition of the version shown.
 * @param format - The value format.
 * @returns Such as `above 2% for 5m`, `below 10` or `no data for 10m`.
 */
export function conditionWords(
  condition: AlertListItem['condition'],
  format: NamedFormatter | null,
): string {
  const wait = durationMs(condition.for) > 0 ? ` for ${condition.for}` : '';
  if (condition.kind === 'no_data') return `no data${wait}`;
  return `${condition.op} ${valueText(condition.value, format)}${wait}`;
}

/**
 * A series' name: its label values, or `all` for the alert as a whole.
 *
 * @param labels - The labels.
 * @returns Such as `checkout-svc` or `500, checkout`.
 */
export function seriesName(labels: Readonly<Record<string, string>>): string {
  const values = Object.values(labels);
  return values.length === 0 ? 'all' : values.join(', ');
}

/**
 * How long ago a time was, short.
 *
 * @param since - The time, in epoch milliseconds.
 * @param now - The current time.
 * @returns Such as `18 min`, `2 h` or `3 d`; at least `1 min`.
 */
export function durationSince(since: number, now: number): string {
  const elapsed = Math.max(0, now - since);
  if (elapsed < hour) return `${Math.max(1, Math.floor(elapsed / minute))} min`;
  if (elapsed < 2 * day) return `${Math.floor(elapsed / hour)} h`;
  return `${Math.floor(elapsed / day)} d`;
}

/**
 * How far a pending series is through its wait.
 *
 * @param since - When it became pending.
 * @param wait - The condition's `for`.
 * @param now - The current time.
 * @returns Such as `2 of 5 min` or `1 of 4 h`.
 */
export function pendingProgress(since: number, wait: string, now: number): string {
  const total = durationMs(wait);
  const unit = total >= 2 * hour ? hour : minute;
  const name = unit === hour ? 'h' : 'min';
  const elapsed = Math.min(Math.floor(Math.max(0, now - since) / unit), total / unit);
  return `${elapsed} of ${Math.round(total / unit)} ${name}`;
}

/**
 * A time, short: the clock today, the weekday within a week, else the date.
 *
 * @param at - The time.
 * @param now - The current time.
 * @param timeZone - The IANA time zone; the browser's when left out.
 * @returns Such as `18:00`, `Tue 09:00` or `28 Sep 14:02`.
 */
export function clockWhen(at: number, now: number, timeZone?: string): string {
  const zone = timeZone ? { timeZone } : {};
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', ...zone });
  const dayOf = (instant: number) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', ...zone }).format(instant);
  if (dayOf(at) === dayOf(now)) return time.format(at);
  const near = Math.abs(at - now) < 6 * day;
  const date = near
    ? { weekday: 'short' as const }
    : { day: 'numeric' as const, month: 'short' as const };
  return `${new Intl.DateTimeFormat('en-GB', { ...date, ...zone }).format(at)} ${time.format(at)}`;
}
