/**
 * Times in what the model reads, written on the person's clock. The gate gives instants in UTC,
 * and a model asked about "14:00" in Zurich compares them as they stand, so a read's instants are
 * rewritten in the time zone of the question before the model sees them.
 */

/** An ISO instant in UTC, as the gate writes them. */
const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;

/**
 * An instant on a time zone's clock, as ISO with that clock's offset, such as
 * `2026-10-03T14:02+02:00`: it reads as the local time and is still a valid instant to cite.
 *
 * @param iso - The instant, in UTC.
 * @param clock - The formatter of the time zone, with its offset.
 * @returns The instant on that clock.
 */
function onClock(iso: string, clock: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(
    clock.formatToParts(Date.parse(iso)).map((part) => [part.type, part.value]),
  );
  const offset = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}${offset}`;
}

/**
 * A value with every UTC instant in it written on a time zone's clock. Anything else is kept.
 *
 * @param value - The value: a read's result, as JSON.
 * @param timeZone - An IANA time zone; an unknown one leaves the value as it is.
 * @returns The value with local times.
 */
export function withLocalTimes<T>(value: T, timeZone: string): T {
  let clock: Intl.DateTimeFormat;
  try {
    clock = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    });
  } catch {
    return value;
  }
  return rewrite(value, (iso) => onClock(iso, clock)) as T;
}

/**
 * A value with each UTC instant string replaced.
 *
 * @param value - The value.
 * @param replace - How an instant is written.
 * @returns The rewritten value.
 */
function rewrite(value: unknown, replace: (iso: string) => string): unknown {
  if (typeof value === 'string') return utcInstant.test(value) ? replace(value) : value;
  if (Array.isArray(value)) return value.map((each) => rewrite(each, replace));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [key, rewrite(each, replace)]),
  );
}
