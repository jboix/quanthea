import { describe, expect, test } from 'bun:test';
import { isQuietAt, type QuietHours, quietHoursOf, quietHoursSchema } from './quiet-hours.ts';

const weekdaysOnly = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

/**
 * Quiet hours with one window.
 *
 * @param timezone - The time zone.
 * @param days - The days the window starts on.
 * @param from - When it starts.
 * @param to - When it ends.
 * @returns The quiet hours.
 */
function hours(
  timezone: string,
  days: readonly QuietHours['windows'][number]['days'][number][],
  from: string,
  to: string,
): QuietHours {
  return { timezone, windows: [{ days: [...days], from, to }] };
}

/**
 * Whether quiet hours hold at a UTC time.
 *
 * @param quietHours - The quiet hours.
 * @param iso - The instant, such as `2026-10-12T21:59Z`.
 * @returns Whether they hold.
 */
const quietAt = (quietHours: QuietHours, iso: string) => isQuietAt(quietHours, Date.parse(iso));

describe('quiet hours', () => {
  test('hold from the start of a window to its end, the end left out', () => {
    // 12 October 2026 is a Monday.
    const lunch = hours('UTC', ['monday'], '12:00', '13:00');
    expect(quietAt(lunch, '2026-10-12T11:59:59Z')).toBe(false);
    expect(quietAt(lunch, '2026-10-12T12:00:00Z')).toBe(true);
    expect(quietAt(lunch, '2026-10-12T12:59:59Z')).toBe(true);
    expect(quietAt(lunch, '2026-10-12T13:00:00Z')).toBe(false);
    expect(quietAt(lunch, '2026-10-13T12:30:00Z')).toBe(false);
  });

  test('cross midnight, on the day the window starts', () => {
    const night = hours('UTC', ['friday'], '22:00', '07:00');
    // 16 October 2026 is a Friday.
    expect(quietAt(night, '2026-10-16T06:00:00Z')).toBe(false);
    expect(quietAt(night, '2026-10-16T21:59:00Z')).toBe(false);
    expect(quietAt(night, '2026-10-16T22:00:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-17T00:00:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-17T06:59:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-17T07:00:00Z')).toBe(false);
    expect(quietAt(night, '2026-10-17T23:00:00Z')).toBe(false);
  });

  test('cross midnight from Sunday into Monday', () => {
    const night = hours('UTC', ['sunday'], '22:00', '07:00');
    expect(quietAt(night, '2026-10-12T06:00:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-13T06:00:00Z')).toBe(false);
  });

  test('last a whole day when the window ends when it starts', () => {
    const weekend = hours('UTC', ['saturday', 'sunday'], '00:00', '00:00');
    expect(quietAt(weekend, '2026-10-16T23:59:00Z')).toBe(false);
    expect(quietAt(weekend, '2026-10-17T00:00:00Z')).toBe(true);
    expect(quietAt(weekend, '2026-10-18T23:59:00Z')).toBe(true);
    expect(quietAt(weekend, '2026-10-19T00:00:00Z')).toBe(false);
  });

  test('hold while any window does', () => {
    const quiet: QuietHours = {
      timezone: 'UTC',
      windows: [
        { days: [...weekdaysOnly], from: '22:00', to: '07:00' },
        { days: ['saturday', 'sunday'], from: '00:00', to: '00:00' },
      ],
    };
    expect(quietAt(quiet, '2026-10-14T12:00:00Z')).toBe(false);
    expect(quietAt(quiet, '2026-10-14T23:00:00Z')).toBe(true);
    expect(quietAt(quiet, '2026-10-17T12:00:00Z')).toBe(true);
  });

  test('follow the clock of the time zone, and its day', () => {
    const night = hours('Asia/Tokyo', ['monday'], '22:00', '07:00');
    // 22:00 on Monday in Tokyo is 13:00 UTC the same day.
    expect(quietAt(night, '2026-10-12T12:59:00Z')).toBe(false);
    expect(quietAt(night, '2026-10-12T13:00:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-12T21:59:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-12T22:00:00Z')).toBe(false);
    // Monday 08:00 in Los Angeles is still Monday there while it is Tuesday in Tokyo.
    const morning = hours('America/Los_Angeles', ['monday'], '08:00', '09:00');
    expect(quietAt(morning, '2026-10-12T15:30:00Z')).toBe(true);
    expect(quietAt(hours('Asia/Tokyo', ['monday'], '00:00', '00:00'), '2026-10-12T15:30:00Z')).toBe(
      false,
    );
  });

  test('keep the same times on the clock across daylight saving', () => {
    const night = hours('Europe/Zurich', [...weekdaysOnly], '22:00', '07:00');
    // Summer, UTC+2: 22:00 is 20:00 UTC. Winter, UTC+1: 22:00 is 21:00 UTC.
    expect(quietAt(night, '2026-10-23T19:59:00Z')).toBe(false);
    expect(quietAt(night, '2026-10-23T20:00:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-26T20:30:00Z')).toBe(false);
    expect(quietAt(night, '2026-10-26T21:00:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-27T05:59:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-27T06:00:00Z')).toBe(false);
  });

  test('last an hour longer the night the clocks go back, an hour less when they go forward', () => {
    const night = hours('Europe/Zurich', ['saturday'], '22:00', '07:00');
    // 24 to 25 October 2026: 03:00 becomes 02:00, so 07:00 is 06:00 UTC, ten hours after 20:00.
    expect(quietAt(night, '2026-10-24T20:00:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-25T05:59:00Z')).toBe(true);
    expect(quietAt(night, '2026-10-25T06:00:00Z')).toBe(false);
    // 28 to 29 March 2026: 02:00 becomes 03:00, so 07:00 is 05:00 UTC, eight hours after 21:00.
    expect(quietAt(night, '2026-03-28T21:00:00Z')).toBe(true);
    expect(quietAt(night, '2026-03-29T04:59:00Z')).toBe(true);
    expect(quietAt(night, '2026-03-29T05:00:00Z')).toBe(false);
  });

  test('end with the jump when the clock skips their end, and hold both times it repeats', () => {
    const early = hours('Europe/Zurich', ['saturday'], '22:00', '02:30');
    // 29 March 2026: the clock goes from 01:59 to 03:00 at 01:00 UTC.
    expect(quietAt(early, '2026-03-29T00:59:00Z')).toBe(true);
    expect(quietAt(early, '2026-03-29T01:00:00Z')).toBe(false);
    // 25 October 2026: the clock shows 02:15 at 00:15 UTC and again at 01:15 UTC.
    expect(quietAt(early, '2026-10-25T00:15:00Z')).toBe(true);
    expect(quietAt(early, '2026-10-25T00:45:00Z')).toBe(false);
    expect(quietAt(early, '2026-10-25T01:15:00Z')).toBe(true);
    expect(quietAt(early, '2026-10-25T01:30:00Z')).toBe(false);
  });

  test('need a known time zone, a day and times of day', () => {
    const valid = hours('Europe/Zurich', ['monday'], '22:00', '07:00');
    expect(quietHoursSchema.safeParse(valid).success).toBe(true);
    expect(quietHoursSchema.safeParse({ ...valid, timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(quietHoursSchema.safeParse(hours('UTC', [], '22:00', '07:00')).success).toBe(false);
    expect(quietHoursSchema.safeParse(hours('UTC', ['monday'], '22h', '07:00')).success).toBe(
      false,
    );
    expect(quietHoursSchema.safeParse({ timezone: 'UTC', windows: [] }).success).toBe(false);
  });
});

describe('the quiet hours an alert keeps', () => {
  const defaults = {
    ...hours('UTC', ['monday'], '22:00', '07:00'),
    exceptSeverities: ['critical'],
  };
  const own = hours('Europe/Zurich', ['sunday'], '00:00', '00:00');

  test('are the default, unless its severity is left alone', () => {
    expect(quietHoursOf({ severity: 'warning' }, defaults)).toBe(defaults);
    expect(quietHoursOf({ severity: 'critical' }, defaults)).toBeNull();
    expect(quietHoursOf({ severity: 'warning' }, null)).toBeNull();
  });

  test('are its own when it sets some, whatever its severity, and none when it says so', () => {
    expect(quietHoursOf({ severity: 'critical', quietHours: own }, defaults)).toBe(own);
    expect(quietHoursOf({ severity: 'critical', quietHours: own }, null)).toBe(own);
    expect(quietHoursOf({ severity: 'info', quietHours: 'none' }, defaults)).toBeNull();
  });
});
