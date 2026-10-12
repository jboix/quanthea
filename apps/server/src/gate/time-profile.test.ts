import { describe, expect, test } from 'bun:test';
import { profilerOf } from './time-profile.ts';

const hour = 3_600_000;
const day = 24 * hour;
// A Monday, at midnight UTC.
const monday = Date.UTC(2026, 9, 5);

/**
 * An hourly series: 10 at every hour, except the evening peak of each day.
 *
 * @param days - How many days.
 * @param peakOf - The hour (UTC) and the value of a day's peak.
 * @returns The points.
 */
function hourly(days: number, peakOf: (dayIndex: number) => { hour: number; value: number }) {
  return Array.from({ length: days * 24 }, (_unused, index) => {
    const peak = peakOf(Math.floor(index / 24));
    return { at: monday + index * hour, value: index % 24 === peak.hour ? peak.value : 10 };
  });
}

describe('by hour of day', () => {
  test('gives each hour its mean and its lowest and highest day', () => {
    const points = hourly(4, (dayIndex) => ({ hour: 20, value: 100 + dayIndex * 10 }));
    const profile = profilerOf('UTC')?.(points);
    expect(profile?.timeZone).toBe('UTC');
    expect(profile?.byHour).toHaveLength(24);
    expect(profile?.byHour?.[20]).toEqual({ hour: 20, mean: 115, min: 100, max: 130 });
    expect(profile?.byHour?.[3]).toEqual({ hour: 3, mean: 10, min: 10, max: 10 });
    expect(profile?.byWeekday).toBeUndefined();
  });

  test('says which hour was the highest of its day, and on how many days', () => {
    const points = hourly(5, (dayIndex) => ({ hour: dayIndex === 2 ? 9 : 20, value: 100 }));
    expect(profilerOf('UTC')?.(points)?.peakHour).toEqual({
      days: 5,
      hours: [
        { hour: 20, days: 4 },
        { hour: 9, days: 1 },
      ],
    });
  });

  test('reads the hours on the clock of the time zone', () => {
    const points = hourly(4, () => ({ hour: 20, value: 100 }));
    const profile = profilerOf('Europe/Zurich')?.(points);
    // 20:00 UTC is 22:00 in Zurich in October.
    expect(profile?.byHour?.find((slot) => slot.max === 100)?.hour).toBe(22);
    expect(profile?.peakHour?.hours[0]?.hour).toBe(22);
  });

  test('means the points of an hour before comparing days', () => {
    const points = Array.from({ length: 3 * 24 * 4 }, (_unused, index) => ({
      at: monday + index * 15 * 60_000,
      value: index % 4,
    }));
    expect(profilerOf('UTC')?.(points)?.byHour?.[7]).toEqual({
      hour: 7,
      mean: 1.5,
      min: 1.5,
      max: 1.5,
    });
  });

  test('leaves a day with points in few of its hours out of the highest hours', () => {
    const points = [
      ...hourly(3, () => ({ hour: 20, value: 100 })),
      { at: monday + 3 * day, value: 5 },
    ];
    expect(profilerOf('UTC')?.(points)?.peakHour).toEqual({
      days: 3,
      hours: [{ hour: 20, days: 3 }],
    });
  });

  test('leaves the day a series starts or ends inside of out of the highest hours', () => {
    // From Monday 12:00 to Friday 15:00: the peak at 20:00 is missing from the last day.
    const points = hourly(5, () => ({ hour: 20, value: 100 })).slice(12, 4 * 24 + 16);
    expect(profilerOf('UTC')?.(points)?.peakHour).toEqual({
      days: 3,
      hours: [{ hour: 20, days: 3 }],
    });
  });

  test('leaves the hour a series of finer buckets starts or ends inside of out', () => {
    // Quarter hours from Monday 00:45 to Thursday 01:00, each worth its minute of the hour.
    const points = Array.from({ length: 3 * 24 * 4 + 2 }, (_unused, index) => ({
      at: monday + (index + 3) * 15 * 60_000,
      value: ((index + 3) % 4) * 15,
    }));
    const profile = profilerOf('UTC')?.(points);
    expect(profile?.byHour?.[0]).toEqual({ hour: 0, mean: 22.5, min: 22.5, max: 22.5 });
    expect(profile?.byHour?.[1]).toEqual({ hour: 1, mean: 22.5, min: 22.5, max: 22.5 });
  });
});

describe('by weekday', () => {
  test('gives each weekday its mean over the weeks, from Monday on', () => {
    const points = Array.from({ length: 14 }, (_unused, index) => ({
      at: monday + index * day,
      value: index % 7 === 5 ? 50 + index : 10,
    }));
    const profile = profilerOf('UTC')?.(points);
    expect(profile?.byHour).toBeUndefined();
    expect(profile?.peakHour).toBeUndefined();
    expect(profile?.byWeekday?.map((slot) => slot.weekday)[0]).toBe('Monday');
    expect(profile?.byWeekday?.[5]).toEqual({
      weekday: 'Saturday',
      mean: 58.5,
      min: 55,
      max: 62,
      days: 2,
    });
  });

  test('a daily bucket cut at midnight UTC keeps its day west of Greenwich', () => {
    const points = Array.from({ length: 14 }, (_unused, index) => ({
      at: monday + index * day,
      value: index % 7 === 0 ? 99 : 10,
    }));
    const profile = profilerOf('America/New_York')?.(points);
    expect(profile?.byWeekday?.find((slot) => slot.max === 99)?.weekday).toBe('Monday');
  });

  test('an hourly series over two weeks has both profiles', () => {
    const profile = profilerOf('UTC')?.(hourly(14, () => ({ hour: 20, value: 100 })));
    expect(profile?.byHour).toHaveLength(24);
    expect(profile?.byWeekday).toHaveLength(7);
    expect(profile?.byWeekday?.[0]).toMatchObject({ weekday: 'Monday', mean: 13.75, days: 2 });
  });

  test('leaves the days a series starts and ends inside of out of their weekday', () => {
    // Fourteen days from Monday 15:00, each point worth its hour of the day.
    const points = Array.from({ length: 14 * 24 }, (_unused, index) => ({
      at: monday + (index + 15) * hour,
      value: (index + 15) % 24,
    }));
    const profile = profilerOf('UTC')?.(points);
    expect(profile?.byWeekday).toHaveLength(7);
    expect(profile?.byWeekday?.[0]).toEqual({
      weekday: 'Monday',
      mean: 11.5,
      min: 11.5,
      max: 11.5,
      days: 1,
    });
    expect(profile?.byWeekday?.[1]).toMatchObject({ weekday: 'Tuesday', mean: 11.5, days: 2 });
  });

  test('leaves a day with points in under half of its buckets out of its weekday', () => {
    // The second Wednesday has its first six hours only.
    const points = hourly(14, () => ({ hour: 3, value: 100 })).filter(
      (_point, index) => Math.floor(index / 24) !== 9 || index % 24 < 6,
    );
    expect(profilerOf('UTC')?.(points)?.byWeekday?.[2]).toEqual({
      weekday: 'Wednesday',
      mean: 13.75,
      min: 13.75,
      max: 13.75,
      days: 1,
    });
  });
});

describe('when a profile means nothing', () => {
  test('none under three days of hourly points', () => {
    expect(profilerOf('UTC')?.(hourly(2, () => ({ hour: 20, value: 100 })))).toBeUndefined();
  });

  test('none by hour for buckets longer than an hour, nor by weekday under two weeks', () => {
    const points = Array.from({ length: 10 * 4 }, (_unused, index) => ({
      at: monday + index * 6 * hour,
      value: index,
    }));
    expect(profilerOf('UTC')?.(points)).toBeUndefined();
  });

  test('none for weekly buckets, however long the series', () => {
    const points = Array.from({ length: 20 }, (_unused, index) => ({
      at: monday + index * 7 * day,
      value: index,
    }));
    expect(profilerOf('UTC')?.(points)).toBeUndefined();
  });

  test('none for several series in one frame, where an hour holds the groups it has', () => {
    // One group of 100 at 03:00 and ten at 15:00, on four days: the mean of both hours is 100.
    const points = Array.from({ length: 4 }, (_unused, dayIndex) => dayIndex).flatMap((dayIndex) =>
      Array.from({ length: 24 }, (_unused, hourOfDay) => hourOfDay).flatMap((hourOfDay) =>
        Array.from({ length: hourOfDay === 15 ? 10 : 1 }, () => ({
          at: monday + dayIndex * day + hourOfDay * hour,
          value: 100,
        })),
      ),
    );
    expect(profilerOf('UTC')?.(points)).toBeUndefined();
  });

  test('none for a single point, and no profiler for an unknown zone', () => {
    expect(profilerOf('UTC')?.([{ at: monday, value: 1 }])).toBeUndefined();
    expect(profilerOf('Not/AZone')).toBeUndefined();
  });
});
