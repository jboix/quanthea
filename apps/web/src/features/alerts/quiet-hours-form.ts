/**
 * The default quiet hours as the alert settings' dialog edits them: what a switch turned on starts
 * with, and what keeps them from being saved.
 */
import {
  type AlertSettings,
  defaultQuietHoursSchema,
  isTimeZone,
  weekdays,
} from '@quanthea/shared';

/** The default quiet hours, as the alert settings hold them. */
export type DefaultQuiet = NonNullable<AlertSettings['quietHours']>;

/** One window of the quiet hours. */
export type QuietWindow = DefaultQuiet['windows'][number];

/**
 * The quiet hours a switch turned on starts with: every night, on the browser's clock, with
 * critical alerts left alone.
 *
 * @returns The quiet hours.
 */
export function startingQuietHours(): DefaultQuiet {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    windows: [{ days: [...weekdays], from: '22:00', to: '07:00' }],
    exceptSeverities: ['critical'],
  };
}

/**
 * What is wrong with quiet hours, if anything.
 *
 * @param quietHours - The quiet hours being edited.
 * @returns The sentence, or `undefined` when they can be saved.
 */
export function quietHoursProblem(quietHours: DefaultQuiet): string | undefined {
  if (!isTimeZone(quietHours.timezone)) return 'Use an IANA time zone such as Europe/Zurich.';
  if (defaultQuietHoursSchema.safeParse(quietHours).success) return undefined;
  return 'Give each window at least one day, a start and an end.';
}

/**
 * A list with an item added when it lacks it, or taken out when it holds it.
 *
 * @param list - The list.
 * @param item - The item.
 * @returns The new list.
 */
export function toggled<Item>(list: readonly Item[], item: Item): Item[] {
  return list.includes(item) ? list.filter((each) => each !== item) : [...list, item];
}
