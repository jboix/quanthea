import { expect, test } from 'bun:test';
import { buildAlertOption, thresholdBounds } from './alert-option.ts';
import { defaultTheme } from './theme.ts';

const input = {
  series: [
    { name: 'checkout', points: [{ at: 0, value: 1 }] },
    { name: 'cart', points: [{ at: 0, value: 2 }] },
  ],
  threshold: 5,
  firing: [{ from: 10, to: 20 }],
  format: (value: number) => `${value}%`,
  from: 0,
  to: 100,
};

test('draws the threshold and the firing periods on the first series, in the danger colour', () => {
  const option = buildAlertOption(input, defaultTheme, 'UTC');
  const [first, second] = option.series as Record<string, unknown>[];
  const markLine = first?.markLine as {
    data: unknown;
    lineStyle: { color: string };
    label: { formatter: () => string };
  };
  expect(markLine.data).toEqual([{ yAxis: 5 }]);
  expect(markLine.lineStyle.color).toBe(defaultTheme.danger);
  expect(markLine.label.formatter()).toBe('5%');
  expect(first?.markArea).toMatchObject({ data: [[{ xAxis: 10 }, { xAxis: 20 }]] });
  expect(second?.markLine).toBeUndefined();
  expect(option.legend).toBeDefined();
});

test('keeps the threshold in view and tooltips on the canvas', () => {
  const option = buildAlertOption(input, defaultTheme, 'UTC');
  expect(option.yAxis).toMatchObject({ max: 6 });
  expect(thresholdBounds({ ...input, threshold: 1.5 })).toEqual({});
  expect(thresholdBounds({ ...input, threshold: 0.2 })).toEqual({ min: 0 });
  expect(thresholdBounds({ ...input, threshold: 0.02, series: [] })).toEqual({ max: 0.025 });
  expect(option.tooltip).toMatchObject({ renderMode: 'richText' });
  const without = buildAlertOption({ ...input, threshold: null }, defaultTheme);
  expect((without.series as Record<string, unknown>[])[0]?.markLine).toBeUndefined();
  expect(without.yAxis).not.toHaveProperty('max');
});
