import { describe, expect, test } from 'bun:test';
import { addUsage, costOf, noUsage, priceOf } from './model-usage.ts';

describe('priceOf', () => {
  test('finds a model by its id, a dated id, or a models/ prefix', () => {
    expect(priceOf('claude-sonnet-5')?.output).toBe(10);
    expect(priceOf('claude-sonnet-5-20260901')?.output).toBe(10);
    expect(priceOf('models/gemini-3.7-flash')?.input).toBe(0.75);
    expect(priceOf('gemma-4-26b-a4b-it')).toBeUndefined();
  });

  test('does not take a longer name for a shorter one', () => {
    expect(priceOf('gemini-3.5-flash-lite')?.input).toBe(0.3);
    expect(priceOf('gemini-3.5-flash')?.input).toBe(1.5);
  });
});

describe('costOf', () => {
  test('prices fresh input, cache reads, cache writes and output apart', () => {
    const usage = addUsage({}, 'claude-sonnet-5', {
      input: 1_000_000,
      cachedInput: 1_000_000,
      cacheWrite: 1_000_000,
      output: 1_000_000,
    });
    expect(costOf(usage)).toEqual({ dollars: 2 + 0.2 + 2.5 + 10, unpriced: [] });
  });

  test('names the models it cannot price', () => {
    const usage = addUsage(addUsage({}, 'gemma-4', noUsage), 'gpt-6-luna', {
      ...noUsage,
      output: 2_000_000,
    });
    expect(costOf(usage)).toEqual({ dollars: 1, unpriced: ['gemma-4'] });
  });
});
