/** The clock of a time zone: the local day, hour and weekday of an instant. */

/** Where an instant falls on a zone's clock. */
export interface ClockTime {
  /** The local day, such as `2026-10-05`. */
  readonly day: string;
  /** The local hour, 0 to 23. */
  readonly hour: number;
  /** The local day of the week, such as `Monday`. */
  readonly weekday: string;
}

/** Reads an instant on a zone's clock. */
export type Clock = (instant: number) => ClockTime;

/**
 * The clock of a time zone. It remembers the instants it has read, since the number columns of a
 * frame share their times.
 *
 * @param timeZone - An IANA time zone.
 * @returns The clock, or `undefined` for an unknown zone.
 */
export function clockOf(timeZone: string): Clock | undefined {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'long',
    });
  } catch {
    return undefined;
  }
  const read = new Map<number, ClockTime>();
  return (instant) => {
    const known = read.get(instant);
    if (known) return known;
    const parts = Object.fromEntries(
      format.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const time = { day, hour: Number(parts.hour), weekday: parts.weekday ?? '' };
    read.set(instant, time);
    return time;
  };
}
