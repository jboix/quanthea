import { describe, expect, test } from 'bun:test';
import type { UsageBucket, UsageReport } from '@quanthea/shared';
import { usageSearch, usageView } from './data.ts';
import { tokensChart } from './usage-charts.ts';
import { dailyUsage, localDay } from './usage-days.ts';
import { usageByFeature } from './usage-features.ts';

const day = localDay(Date.parse('2026-09-28T12:00:00'));
const hour = 3_600_000;

/**
 * A model step bucket of one feature.
 *
 * @param feature - The feature it served.
 * @param dollars - Its cost.
 * @param events - How many steps.
 * @returns The bucket.
 */
function step(feature: UsageBucket['feature'], dollars: number, events = 1): UsageBucket {
  return {
    hour: day + 9 * hour,
    kind: 'model',
    provider: 'mistral',
    vendor: 'mistral',
    model: 'mistral-large-latest',
    feature,
    userId: 'ada',
    input: 100,
    cachedInput: 50,
    cacheWrite: 10,
    output: 20,
    dollars,
    events,
    unpriced: 0,
  };
}

const view: UsageBucket = {
  ...step(null, 0, 4),
  kind: 'pinned_view',
  provider: '',
  vendor: '',
  model: '',
};

const report: UsageReport = {
  from: day,
  to: day + 20 * hour,
  pricesCheckedOn: '2026-09-29',
  buckets: [
    step('building', 0.01, 3),
    step('explanation', 0.002),
    step('building', 0.01),
    { ...step('question', 0), unpriced: 1 },
    view,
  ],
  people: {},
};

describe('usageByFeature', () => {
  test('gives one row per feature that ran a model, the costliest first, with plain names', () => {
    const rows = usageByFeature(report).map((row) => [row.name, row.steps, row.unpriced]);
    expect(rows).toEqual([
      ['Building dashboards', 4, false],
      ['Panel explanations', 1, false],
      ['Questions about dashboards', 1, true],
    ]);
    expect(usageByFeature(report)[0]).toMatchObject({
      feature: 'building',
      input: 220,
      cached: 100,
      output: 40,
      dollars: 0.02,
    });
  });

  test('gives no row when no model ran', () => {
    expect(usageByFeature({ ...report, buckets: [view] })).toEqual([]);
  });
});

describe('the split by feature', () => {
  test('draws every feature, in a fixed order, so each keeps its colour', () => {
    const chart = tokensChart(dailyUsage(report), { shown: [], other: false }, 'feature');
    const text = JSON.stringify(chart.datasets);
    const order = ['Building dashboards', 'Questions about dashboards', 'Panel explanations'].map(
      (name) => text.indexOf(name),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((first, second) => first - second)).toEqual(order);
  });
});

describe('the usage address', () => {
  test('keeps the split by model out of the address', () => {
    expect(usageSearch(7, 'model')).toBe('?days=7');
    expect(usageSearch(90, 'feature')).toBe('?days=90&by=feature');
  });

  test('reads the range and the split, 30 days by model by default', () => {
    expect(usageView(new URLSearchParams('days=7&by=feature'))).toEqual({
      days: 7,
      split: 'feature',
    });
    expect(usageView(new URLSearchParams('days=12&by=job'))).toEqual({ days: 30, split: 'model' });
  });
});
