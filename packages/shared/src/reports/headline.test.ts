import { describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/plugin-kit/contract';
import { createFormatter } from '../formatters/format.ts';
import { changeOf, headlineOf } from './headline.ts';

/**
 * The outcome of one query returning one number.
 *
 * @param value - The number, or `null` for no row.
 * @returns The outcomes of the panel's queries.
 */
function outcome(value: number | null) {
  const frame: Frame = {
    refId: 'A',
    fields: [{ name: 'revenue', type: 'number' }],
    values: [value === null ? [] : [value]],
    meta: { rowCount: value === null ? 0 : 1, truncated: false, durationMs: 1 },
  };
  return [{ refId: 'A', frames: [frame], error: null }];
}

describe('a change', () => {
  test('of a number is a share of the one before, rounded to one decimal', () => {
    const chf = { $fmt: 'currency', code: 'CHF' } as const;
    expect(changeOf(184_320, 173_560, chf)).toEqual({ direction: 'up', text: '▲ 6.2%' });
    expect(changeOf(90, 100, chf)).toEqual({ direction: 'down', text: '▼ 10%' });
    expect(changeOf(100, 100, chf)).toEqual({ direction: 'flat', text: 'no change' });
  });

  test('of a percentage is in points', () => {
    const ratio = { $fmt: 'percent', input: 'ratio' } as const;
    expect(changeOf(0.018, 0.022, ratio)).toEqual({ direction: 'down', text: '▼ 0.4 pt' });
    expect(changeOf(1.8, 1.2, { $fmt: 'percent', input: 'percent' })).toEqual({
      direction: 'up',
      text: '▲ 0.6 pt',
    });
  });

  test('has nothing to compare without a number before, or from zero', () => {
    expect(changeOf(5, null, '{value}')).toBeNull();
    expect(changeOf(null, 5, '{value}')).toBeNull();
    expect(changeOf(5, 0, '{value}')).toBeNull();
  });
});

describe('a headline', () => {
  const panel = {
    id: 'revenue',
    title: 'Revenue',
    view: {
      kind: 'stat',
      ref: 'A',
      reduce: 'sum',
      format: { $fmt: 'currency', code: 'CHF', decimals: 0 },
    },
  } as const;

  const chf = createFormatter(panel.view.format);

  test('reads the stat as the panel shows it, with the period before', () => {
    expect(headlineOf(panel, outcome(184_320), outcome(173_560), 'UTC')).toEqual({
      panelId: 'revenue',
      title: 'Revenue',
      value: 184_320,
      text: chf(184_320),
      previous: 173_560,
      previousText: chf(173_560),
      change: { direction: 'up', text: '▲ 6.2%' },
    });
  });

  test('says when there is no number, and when there is no comparison', () => {
    const last = { ...panel, view: { ...panel.view, reduce: 'last' } } as const;
    const headline = headlineOf(last, outcome(null), null, 'UTC');
    expect(headline).toMatchObject({ value: null, text: '–', previousText: null, change: null });
  });
});
