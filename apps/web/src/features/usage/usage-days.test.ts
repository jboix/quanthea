import { describe, expect, test } from 'bun:test';
import type { UsageBucket, UsageReport } from '@quanthea/shared';
import {
  chartedModels,
  dailyUsage,
  localDay,
  providerNames,
  totalUsage,
  usageByModel,
} from './usage-days.ts';
import { usageByUser } from './usage-people.ts';

const day = localDay(Date.parse('2026-09-28T12:00:00'));
const hour = 3_600_000;

/**
 * A model step bucket.
 *
 * @param at - Its hour.
 * @param model - Its model.
 * @param dollars - Its cost.
 * @param userId - Who it ran for.
 * @param feature - The feature it served.
 * @returns The bucket.
 */
function step(
  at: number,
  model: string,
  dollars: number,
  userId = 'ada',
  feature: UsageBucket['feature'] = 'building',
): UsageBucket {
  return {
    hour: at,
    kind: 'model',
    provider: 'mistral',
    vendor: 'mistral',
    model,
    feature,
    userId,
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
      feature: null,
      provider: '',
      vendor: '',
      input: 0,
      cachedInput: 0,
      cacheWrite: 0,
      output: 0,
      events: 3,
    },
    {
      ...step(day + 10 * hour, '', 0),
      kind: 'snapshot_view',
      feature: null,
      provider: '',
      vendor: '',
      input: 0,
      cachedInput: 0,
      cacheWrite: 0,
      output: 0,
      events: 2,
    },
    step(day + 11 * hour, 'mistral-large-latest', 0.01, 'bob', 'question'),
  ],
  people: { ada: { name: 'Ada', role: 'admin' }, bob: { name: 'Bob', role: 'editor' } },
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
      views: 5,
      byModel: {
        'mistral-large-latest': { tokens: 360, dollars: 0.02 },
        'mistral-small-latest': { tokens: 180, dollars: 0.002 },
      },
      byFeature: {
        building: { tokens: 360, dollars: 0.012 },
        question: { tokens: 180, dollars: 0.01 },
      },
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
      views: 5,
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

  test('keeps a model apart by the vendor its steps reached, with the provider name', () => {
    const gemini = {
      ...step(day, 'gemini-3.7-flash', 0.01),
      provider: 'Anthropic',
      vendor: 'gemini',
    };
    const older = { ...gemini, vendor: '' };
    const rows = usageByModel({ ...report, buckets: [gemini, older, gemini] });
    expect(rows.map(({ provider, vendor, steps }) => [provider, vendor, steps])).toEqual([
      ['Anthropic', 'gemini', 4],
      ['Anthropic', '', 2],
    ]);
  });
});

describe('providerNames', () => {
  test('names the vendor, with the provider name when it differs', () => {
    expect(providerNames({ provider: 'Anthropic', vendor: 'gemini' })).toEqual({
      vendor: 'Gemini',
      name: 'Anthropic',
    });
    expect(providerNames({ provider: 'Gemini', vendor: 'gemini' })).toEqual({
      vendor: 'Gemini',
      name: null,
    });
    expect(providerNames({ provider: 'LiteLLM', vendor: 'openai-compatible' })).toEqual({
      vendor: 'OpenAI compatible',
      name: 'LiteLLM',
    });
  });

  test('falls back to the provider name for steps recorded before the vendor was kept', () => {
    expect(providerNames({ provider: 'Anthropic', vendor: '' })).toEqual({
      vendor: 'Anthropic',
      name: null,
    });
  });
});

describe('usageByUser', () => {
  test('gives one row per person who ran a model, the costliest first', () => {
    expect(usageByUser(report).map((row) => [row.name, row.role, row.steps, row.tokens])).toEqual([
      ['Ada', 'admin', 4, 360],
      ['Bob', 'editor', 2, 180],
    ]);
  });
});

describe('chartedModels', () => {
  test('draws the costliest models one by one, and gathers the rest as Other', () => {
    const models = usageByModel(report);
    expect(chartedModels(models, 1)).toEqual({ shown: ['mistral-large-latest'], other: true });
    expect(chartedModels(models)).toEqual({
      shown: ['mistral-large-latest', 'mistral-small-latest'],
      other: false,
    });
  });

  test('draws a model reached through two vendors as one series', () => {
    const models = usageByModel(report);
    const [first] = models;
    if (!first) throw new Error('The report has a model.');
    const twice = [first, { ...first, vendor: '' }, ...models.slice(1)];
    expect(chartedModels(twice, 2)).toEqual({
      shown: ['mistral-large-latest', 'mistral-small-latest'],
      other: false,
    });
  });
});
