import { describe, expect, test } from 'bun:test';
import type { UsageBucket, UsageReport } from '@querent/shared';
import { dailyUsage, localDay, totalUsage, usageByModel } from './usage-days.ts';

const day = localDay(Date.parse('2026-09-28T12:00:00'));
const hour = 3_600_000;

/**
 * A model step bucket.
 *
 * @param at - Its hour.
 * @param model - Its model.
 * @param dollars - Its cost.
 * @returns The bucket.
 */
function step(at: number, model: string, dollars: number): UsageBucket {
  return {
    hour: at,
    kind: 'model',
    provider: 'mistral',
    model,
    input: 100,
    cachedInput: 50,
    cacheWrite: 10,
    output: 20,
    dollars,
    events: 2,
    unpriced: 0,
  };
}

const report: UsageReport = {
  from: day - 2 * 24 * hour,
  to: day + 20 * hour,
  pricesCheckedOn: '2026-09-29',
  buckets: [
    step(day + 9 * hour, 'mistral-large-latest', 0.01),
    step(day + 10 * hour, 'mistral-small-latest', 0.002),
    {
      ...step(day + 10 * hour, '', 0),
      kind: 'pinned_view',
      provider: '',
      input: 0,
      cachedInput: 0,
      cacheWrite: 0,
      output: 0,
      events: 3,
    },
    step(day + 11 * hour, 'mistral-large-latest', 0.01),
  ],
};

describe('dailyUsage', () => {
  test('adds hours into local days, with the empty days of the range', () => {
    const days = dailyUsage(report);
    expect(days.map((each) => each.day)).toEqual([day - 2 * 24 * hour, day - 24 * hour, day]);
    expect(days[2]).toEqual({
      day,
      input: 330,
      cached: 150,
      output: 60,
      dollars: 0.022,
      steps: 6,
      views: 3,
    });
    expect(days[0]?.steps).toBe(0);
  });

  test('sums the range', () => {
    expect(totalUsage(dailyUsage(report))).toEqual({
      input: 330,
      cached: 150,
      output: 60,
      dollars: 0.022,
      steps: 6,
      views: 3,
    });
  });
});

describe('usageByModel', () => {
  test('gives one row per model, the costliest first, without pinned views', () => {
    expect(usageByModel(report).map((row) => [row.model, row.steps, row.dollars])).toEqual([
      ['mistral-large-latest', 4, 0.02],
      ['mistral-small-latest', 2, 0.002],
    ]);
  });
});
