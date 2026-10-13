/**
 * Where and when the questions are asked from: the time zone of the person, and the hour of the
 * dev data's incident on their clock.
 */

/** The time zone the questions are asked from. */
export const zurich = 'Europe/Zurich';

/**
 * The incident's hour on a clock in a time zone: yesterday 12:00 UTC is "14:00" in Zurich in
 * summer and "13:00" in winter, so a question names the hour the person saw.
 *
 * @param timeZone - The time zone.
 * @param now - The current instant; the time of the run by default.
 * @returns The hour, such as "14:00".
 */
export function incidentHour(timeZone: string, now = new Date()): string {
  const noon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 12);
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  return `${clock.format(noon)}:00`;
}
