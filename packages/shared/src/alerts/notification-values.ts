/**
 * The values an alert's message template is filled with, from one series: the server's
 * notifications and the draft pane's previews fill them the same way.
 */
import { calendarParts } from '../formatters/calendar.ts';
import { createFormatter } from '../formatters/format.ts';
import type { MessagePlaceholder } from '../notifications.ts';
import type { AlertSpec } from '../spec/alert.ts';

/** The series a notification is about. */
export interface NotifiedSeries {
  /** Its labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** Its value. */
  readonly value: number | null;
  /** When it entered its state, in epoch milliseconds. */
  readonly since: number;
}

/**
 * Writes a value as the spec's format asks, or with four significant digits.
 *
 * @param spec - The spec.
 * @param value - The value.
 * @returns The text; empty without a value.
 */
export function alertValueText(spec: Pick<AlertSpec, 'value'>, value: number | null): string {
  if (value === null) return '';
  if (spec.value.format) return createFormatter(spec.value.format)(value);
  return new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }).format(value);
}

/**
 * Writes the threshold.
 *
 * @param spec - The spec.
 * @returns Such as `above 5`, or `no data`.
 */
export function thresholdText(spec: Pick<AlertSpec, 'value' | 'condition'>): string {
  const { condition } = spec;
  if (condition.kind === 'no_data') return 'no data';
  return `${condition.op} ${alertValueText(spec, condition.value)}`;
}

/**
 * Writes an instant in the spec's time zone.
 *
 * @param spec - The spec.
 * @param at - The instant.
 * @returns Such as `4 Oct, 12:04 UTC`.
 */
function timeText(spec: Pick<AlertSpec, 'timezone'>, at: number): string {
  const timeZone = spec.timezone ?? 'UTC';
  const zone = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  const { day, month, time } = calendarParts(at, timeZone);
  return `${day} ${month}, ${time}${zone ? ` ${zone}` : ''}`;
}

/**
 * The values of a message template for one series.
 *
 * @param spec - The spec.
 * @param series - The series.
 * @param url - The link to the alert.
 * @returns A value for every placeholder.
 */
export function notificationValues(
  spec: AlertSpec,
  series: NotifiedSeries,
  url: string,
): Record<MessagePlaceholder, string> {
  const labels = Object.entries(series.labels).map(([name, value]) => `${name}=${value}`);
  return {
    alert: spec.title,
    series: labels.length > 0 ? labels.join(', ') : 'all',
    value: alertValueText(spec, series.value),
    threshold: thresholdText(spec),
    duration: spec.condition.for,
    since: timeText(spec, series.since),
    severity: spec.severity,
    link: url,
  };
}
