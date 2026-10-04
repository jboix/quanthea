import { describe, expect, test } from 'bun:test';
import { observe, wholeAlertKey } from './observe.ts';
import { reducePoints, seriesKeyOf, seriesOf } from './series.ts';
import { frameOf, minute, seriesFrame, spec } from './test/fixtures.ts';

const value = spec().value;

describe('series of a result', () => {
  test('are the labels of each time series, keyed in order', () => {
    const frames = [
      seriesFrame({ service: 'checkout', code: '500' }, [[0, 1]]),
      seriesFrame({ service: 'cart', code: '500' }, [[0, 2]]),
    ];
    const { series } = seriesOf(frames, value);
    expect(series.map((each) => each.key)).toEqual([
      '{code="500", service="cart"}',
      '{code="500", service="checkout"}',
    ]);
  });

  test('take the text columns of rows, or the columns the spec names', () => {
    const frame = frameOf(
      [
        { name: 'time', type: 'time' },
        { name: 'service', type: 'string' },
        { name: 'region', type: 'string' },
        { name: 'errors', type: 'number' },
      ],
      [
        [0, 0, minute],
        ['checkout', 'cart', 'checkout'],
        ['eu', 'eu', 'us'],
        [3, 4, 5],
      ],
    );
    expect(seriesOf([frame], value).series).toHaveLength(3);
    const byService = seriesOf([frame], { ...value, by: ['service'] }).series;
    expect(byService.map((each) => [each.key, each.points.length])).toEqual([
      ['{service="cart"}', 1],
      ['{service="checkout"}', 2],
    ]);
    expect(seriesOf([frame], { ...value, by: ['host'] }).problems).toEqual(['No column "host".']);
    expect(seriesOf([frame], { ...value, field: 'service' }).problems).toEqual([
      '"service" is not a number column.',
    ]);
  });

  test('stop at the cap, and say so', () => {
    const frames = ['a', 'b', 'c'].map((name) => seriesFrame({ name }, [[0, 1]]));
    const extraction = seriesOf(frames, { ...value, maxSeries: 2 });
    expect(extraction.series.map((each) => each.labels.name)).toEqual(['a', 'b']);
    expect(extraction.truncated).toBe(true);
  });

  test('reduce their points', () => {
    const points = [
      { at: 2, value: 5 },
      { at: 3, value: 1 },
      { at: 1, value: 9 },
    ];
    expect(reducePoints(points, 'last')).toBe(1);
    expect(reducePoints(points, 'max')).toBe(9);
    expect(reducePoints(points, 'min')).toBe(1);
    expect(reducePoints(points, 'mean')).toBe(5);
    expect(reducePoints(points, 'sum')).toBe(15);
    expect(reducePoints([], 'last')).toBeNull();
  });
});

describe('observing a result', () => {
  const known = new Map([[seriesKeyOf({ service: 'cart' }), { service: 'cart' }]]);

  test('reads each series against the threshold, and a known series left out as missing', () => {
    const frames = [
      seriesFrame({ service: 'checkout' }, [
        [0, 3],
        [minute, 7],
      ]),
    ];
    const observed = observe(spec(), { frames }, known).series;
    expect(observed.get('{service="checkout"}')?.observation).toEqual({
      kind: 'value',
      value: 7,
      holds: true,
    });
    expect(observed.get('{service="cart"}')?.observation).toEqual({ kind: 'missing' });
  });

  test('reads an empty result as no data for the known series', () => {
    const observed = observe(spec(), { frames: [] }, known).series;
    expect(observed.get('{service="cart"}')?.observation).toEqual({ kind: 'no_data' });
  });

  test('puts a failed query on the alert as a whole', () => {
    const observed = observe(spec(), { error: 'timeout' }, known).series;
    expect([...observed.keys()]).toEqual([wholeAlertKey]);
    expect(observed.get(wholeAlertKey)?.observation).toEqual({ kind: 'error', message: 'timeout' });
  });

  test('holds a no-data condition when nothing comes back', () => {
    const noData = spec({ condition: { kind: 'no_data', for: '5m' } });
    const empty = observe(noData, { frames: [] }, new Map()).series.get(wholeAlertKey);
    expect(empty?.observation).toEqual({ kind: 'value', value: null, holds: true });
    const frames = [seriesFrame({}, [[0, 1]])];
    const some = observe(noData, { frames }, new Map()).series.get(wholeAlertKey);
    expect(some?.observation).toMatchObject({ holds: false });
  });

  test('holds below a threshold for a below condition', () => {
    const below = spec({ condition: { kind: 'threshold', op: 'below', value: 2, for: '0m' } });
    const frames = [seriesFrame({}, [[0, 1]])];
    expect(observe(below, { frames }, new Map()).series.get('{}')?.observation).toMatchObject({
      holds: true,
    });
  });
});
