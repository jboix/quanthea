/**
 * The values an alert's message template is filled with, from one series: the server's
 * notifications and the draft pane's previews fill them the same way.
 */
import { calendarParts } from '../formatters/calendar.ts';
import type { MessagePlaceholder } from '../notifications.ts';
import type { AlertSpec } from '../spec/alert.ts';
import { alertValueText, changeWords, conditionText, readingsText } from './condition-words.ts';
import type { Reading } from './conditions.ts';

/** The series a notification is about. */
export interface NotifiedSeries {
  /** Its labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** Its value. */
  readonly value: number | null;
  /** When it entered its state, in epoch milliseconds. */
  readonly since: number;
  /**
   * What each test of the condition read, when that is more than the value: the earlier point of
   * a change, the values of the parts of a joined condition.
   */
  readonly readings?: readonly Reading[] | undefined;
}

/**
 * Writes the condition a series is held against.
 *
 * @param spec - The spec.
 * @returns Such as `above 5`, `down 50% or more within 10m`, or `no data`.
 */
export function thresholdText(spec: Pick<AlertSpec, 'value' | 'condition'>): string {
  return conditionText(spec);
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
  const zoneText = zone ? ` ${zone}` : '';
  return `${day} ${month}, ${time}${zoneText}`;
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
  const readings = series.readings ?? [{ value: series.value }];
  return {
    alert: spec.title,
    series: labels.length > 0 ? labels.join(', ') : 'all',
    value: alertValueText(spec, series.value),
    values: readingsText(spec, readings),
    ...changeWords(spec, readings),
    threshold: thresholdText(spec),
    duration: spec.condition.for,
    since: timeText(spec, series.since),
    severity: spec.severity,
    link: url,
  };
}
