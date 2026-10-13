import { describe, expect, test } from 'bun:test';
import { drawnAt, drawnNote, drawnPoints } from './drawn-interval.ts';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

describe('how a replay chart is drawn', () => {
  test('a day checked every minute is drawn by 10 minutes when nobody chose', () => {
    const drawn = drawnAt({ from: 0, to: day, stepMs: minute }, 'auto');
    expect(drawn.interval).toBe('10m');
    expect(drawn.options).toEqual(['auto', 'every check', '5m', '10m', '30m', '1h', '6h']);
  });

  test('a week is drawn by the hour, and a chosen interval of the window wins', () => {
    const week = { from: 0, to: 7 * day, stepMs: minute };
    expect(drawnAt(week, 'auto').interval).toBe('1h');
    expect(drawnAt(week, '6h')).toMatchObject({ value: '6h', interval: '6h' });
  });

  test('every check draws the checks as they are', () => {
    expect(drawnAt({ from: 0, to: day, stepMs: minute }, 'every check').interval).toBeNull();
  });

  test('offers nothing as fine as the checks, and draws them when they are coarser', () => {
    const hourly = drawnAt({ from: 0, to: day, stepMs: hour }, 'auto');
    expect(hourly.options).toEqual(['auto', 'every check', '6h']);
    expect(hourly.interval).toBeNull();
  });

  test('a choice another window does not offer reads as automatic', () => {
    const drawn = drawnAt({ from: 0, to: 7 * day, stepMs: minute }, '5m');
    expect(drawn).toMatchObject({ value: 'auto', interval: '1h' });
  });
});

describe('the points of an interval', () => {
  const checks = [
    { at: 0, value: 1 },
    { at: 5 * minute, value: 3 },
    { at: 10 * minute, value: null },
    { at: 15 * minute, value: null },
    { at: 20 * minute, value: 10 },
  ];

  test('are the checks themselves when no interval is drawn', () => {
    expect(drawnPoints(checks, null)).toBe(checks);
  });

  test('are the mean of the checks in it, at the mean of their times', () => {
    expect(drawnPoints(checks, '10m')).toEqual([
      { at: 2.5 * minute, value: 2 },
      { at: 12.5 * minute, value: null },
      { at: 20 * minute, value: 10 },
    ]);
  });

  test('carry the mean of what each test read, so the lines are cut the same way', () => {
    const read = [
      { at: 0, value: 1, readings: [{ value: 1, reference: 10, spread: 2 }] },
      { at: 5 * minute, value: 3, readings: [{ value: 3, reference: 20, spread: null }] },
    ];
    expect(drawnPoints(read, '10m')).toEqual([
      { at: 2.5 * minute, value: 2, readings: [{ value: 2, reference: 15, spread: 2 }] },
    ]);
  });

  test('skip an interval without a check', () => {
    const sparse = [
      { at: 0, value: 1 },
      { at: 3 * hour, value: 2 },
    ];
    expect(drawnPoints(sparse, '1h').map((point) => point.at)).toEqual([0, 3 * hour]);
  });
});

describe('the sentence under the chart', () => {
  test('tells the interval of the chart from how often the alert is checked', () => {
    expect(drawnNote('1h', '1m')).toBe(
      'The chart draws one point per 1h, the mean of the checks in it. The alert is still checked every minute: the firing periods come from those checks, not from the line.',
    );
    expect(drawnNote(null, '5m')).toBe(
      'The chart draws every check: the alert is checked every 5 minutes.',
    );
  });
});
