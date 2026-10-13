import { describe, expect, test } from 'bun:test';
import { type Frame, replayUnder } from '@quanthea/shared';
import { checkAlert } from './check.ts';
import { measure, measuresOf, readingOf, readSeries } from './measure.ts';
import { observe } from './observe.ts';
import { replaySeries } from './replay-core.ts';
import { fakeEngine, frameOf, minute, seriesFrame, spec } from './test/fixtures.ts';

/** Dropped by half within 10 minutes, read over 20. */
const dropped = spec({
  condition: {
    kind: 'change',
    direction: 'down',
    amount: 50,
    unit: 'percent',
    within: '10m',
    for: '0m',
  },
  lookback: '20m',
});

/** Error share above 2% with more than 100 requests, per service. */
const busy = spec({
  value: { field: 'share', by: ['service'] },
  condition: {
    kind: 'all',
    of: [
      { kind: 'threshold', op: 'above', value: 0.02 },
      { kind: 'threshold', op: 'above', value: 100, field: 'requests', reduce: 'sum' },
    ],
    for: '0m',
  },
});

/**
 * Rows of a share and a request count per service.
 *
 * @param rows - Time, service, share and requests; `null` for a cell without a number.
 * @returns The frame.
 */
function shares(rows: readonly (readonly [number, string, number | null, number | null])[]): Frame {
  return frameOf(
    [
      { name: 'time', type: 'time' },
      { name: 'service', type: 'string' },
      { name: 'share', type: 'number' },
      { name: 'requests', type: 'number' },
    ],
    [0, 1, 2, 3].map((column) => rows.map((row) => row[column])),
  );
}

/**
 * Points a minute apart.
 *
 * @param values - The value at each minute from 0.
 * @returns The points.
 */
function perMinute(values: readonly number[]) {
  return values.map((value, index) => ({ at: index * minute, value }));
}

describe('the measures of a condition', () => {
  test('are the alert’s value for a single test, and for none', () => {
    expect(measuresOf(spec())).toEqual([{ field: undefined, reduce: 'last', withinMs: null }]);
    const noData = spec({ condition: { kind: 'no_data', for: '5m' }, value: { reduce: 'max' } });
    expect(measuresOf(noData)).toEqual([{ field: undefined, reduce: 'max', withinMs: null }]);
  });

  test('are one per test of a joined condition, each with its field and reducer', () => {
    expect(measuresOf(busy)).toEqual([
      { field: 'share', reduce: 'last', withinMs: null },
      { field: 'requests', reduce: 'sum', withinMs: null },
    ]);
  });

  test('read the latest point for a change, with its span', () => {
    expect(measuresOf(dropped)).toEqual([
      { field: undefined, reduce: 'last', withinMs: 10 * minute },
    ]);
  });
});

describe('reading a change', () => {
  const [change] = measuresOf(dropped);
  if (!change) throw new Error('no measure');

  test('compares the latest point with the latest one at least the span before it', () => {
    const points = perMinute([100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 4]);
    expect(readingOf(points, change)).toEqual({ value: 4, reference: 90 });
    // A gap: the earlier point is the last one before the span, however old.
    const sparse = [
      { at: 0, value: 100 },
      { at: 19 * minute, value: 40 },
    ];
    expect(readingOf(sparse, change)).toEqual({ value: 40, reference: 100 });
  });

  test('has no earlier point with too little history, one point, or no times', () => {
    expect(readingOf(perMinute([100, 90, 80]), change)).toEqual({ value: 80, reference: null });
    expect(readingOf([{ at: 5 * minute, value: 7 }], change)).toEqual({
      value: 7,
      reference: null,
    });
    const untimed = [
      { at: null, value: 100 },
      { at: null, value: 10 },
    ];
    expect(readingOf(untimed, change)).toEqual({ value: 10, reference: null });
    expect(readingOf([], change)).toEqual({ value: null, reference: null });
  });

  test('holds from the earlier point: a half, not from zero in percent', () => {
    const halved = [...perMinute([100]), { at: 10 * minute, value: 50 }];
    expect(readSeries(dropped, [change], [halved])).toMatchObject({ value: 50, holds: true });
    const fromZero = [...perMinute([0]), { at: 10 * minute, value: -5 }];
    expect(readSeries(dropped, [change], [fromZero])).toMatchObject({ value: -5, holds: false });
    expect(readSeries(dropped, [change], [perMinute([100, 10])])).toMatchObject({ holds: false });
  });
});

describe('observing a joined condition', () => {
  test('reads each part from its own column of the same rows', () => {
    const frame = shares([
      [0, 'cart', 0.05, 30],
      [0, 'checkout', 0.05, 80],
      [minute, 'cart', 0.05, 40],
      [minute, 'checkout', 0.03, 90],
    ]);
    const observed = observe(busy, { frames: [frame] }, new Map()).series;
    expect(observed.get('{service="cart"}')?.observation).toEqual({
      kind: 'value',
      value: 0.05,
      holds: false,
      readings: [{ value: 0.05 }, { value: 70 }],
    });
    // The series reports its first part: the share, while the requests are summed.
    expect(observed.get('{service="checkout"}')?.observation).toMatchObject({
      value: 0.03,
      holds: true,
    });
  });

  test('takes a part with no value for a series as not holding, under all and any', () => {
    const frame = shares([
      [0, 'cart', 0.05, null],
      [0, 'checkout', null, 500],
    ]);
    const all = observe(busy, { frames: [frame] }, new Map()).series;
    expect(all.get('{service="cart"}')?.observation).toMatchObject({ value: 0.05, holds: false });
    expect(all.get('{service="checkout"}')?.observation).toMatchObject({
      value: null,
      holds: false,
    });
    const any = spec({ ...busy, condition: { ...busy.condition, kind: 'any' } });
    const either = observe(any, { frames: [frame] }, new Map()).series;
    expect(either.get('{service="cart"}')?.observation).toMatchObject({ holds: true });
    expect(either.get('{service="checkout"}')?.observation).toMatchObject({
      value: null,
      holds: true,
    });
  });

  test('cannot be checked when a part names a column the result does not have', () => {
    const frame = frameOf(
      [
        { name: 'service', type: 'string' },
        { name: 'share', type: 'number' },
      ],
      [['cart'], [0.05]],
    );
    expect(measure([frame], busy).problems).toEqual(['No column "requests".']);
    const observed = observe(busy, { frames: [frame] }, new Map()).series;
    expect(observed.get('')?.observation).toEqual({
      kind: 'error',
      message: 'No column "requests".',
    });
  });

  test('leaves a known series out as missing, and an empty result as no data', () => {
    const known = new Map([['{service="cart"}', { service: 'cart' }]]);
    const frame = shares([[0, 'checkout', 0.05, 500]]);
    const partly = observe(busy, { frames: [frame] }, known).series;
    expect(partly.get('{service="cart"}')?.observation).toEqual({ kind: 'missing' });
    const empty = observe(busy, { frames: [] }, known).series;
    expect(empty.get('{service="cart"}')?.observation).toEqual({ kind: 'no_data' });
  });
});

describe('checking a change before it is saved', () => {
  /**
   * Checks the change alert against frames.
   *
   * @param frames - What the query returns.
   * @returns The check.
   */
  const check = (frames: Frame[]) =>
    checkAlert(
      {
        ...fakeEngine(() => frames),
        lookup: () => ({
          language: 'promql',
          guardrails: { timeoutMs: 1000, maxRows: 1000, maxRangeDays: 31 },
        }),
      },
      dropped,
      20 * minute,
    );

  test('reads each series with whether it holds now', async () => {
    const points = [0, 5, 10, 15].map((at, index) => [at * minute, [100, 90, 40, 30][index]]);
    const result = await check([
      seriesFrame({ service: 'checkout' }, points as [number, number][]),
    ]);
    expect(result).toMatchObject({ ok: true, series: [{ value: 30, holds: true }] });
  });

  test('refuses a result whose series have no earlier point, such as an instant query', async () => {
    const result = await check([seriesFrame({ service: 'checkout' }, [[19 * minute, 30]])]);
    expect(result.ok).toBe(false);
    const [issue] = result.ok ? [] : result.issues;
    expect(issue?.path).toBe('condition.within');
    expect(issue?.message).toContain('No series has a point 10m before its latest one');
  });

  test('takes an empty result: there is nothing to judge yet', async () => {
    expect(await check([])).toMatchObject({ ok: true, series: [] });
  });
});

describe('replaying a change and a joined condition', () => {
  // Steady at 100, halves at minute 30, stays there.
  const values = Array.from({ length: 61 }, (_unused, at) => (at < 30 ? 100 : 50));
  const window = { from: 0, to: 60 * minute, stepMs: minute };

  /**
   * One series as a spec's condition reads it, every measure on the same points.
   *
   * @param subject - The spec.
   * @param points - The points.
   * @returns The measured series.
   */
  const measured = (subject: typeof dropped, points: readonly { at: number; value: number }[]) => ({
    measures: measuresOf(subject),
    series: [{ key: '{}', labels: {}, columns: measuresOf(subject).map(() => points) }],
  });

  test('fires on the drop, and resolves once the earlier point has caught up', () => {
    const [series] = replaySeries(dropped, measured(dropped, perMinute(values)), window);
    expect(series?.firing).toEqual([{ from: 30 * minute, to: 40 * minute, ongoing: false }]);
    expect(series?.points[30]).toEqual({
      at: 30 * minute,
      value: 50,
      readings: [{ value: 50, reference: 100 }],
    });
    // Too little history at the start: the value is reported, nothing is compared.
    expect(series?.points[5]?.readings).toEqual([{ value: 100, reference: null }]);
  });

  test('is judged again in the browser as the server replays it, at another amount', () => {
    const wavy = Array.from({ length: 61 }, (_unused, at) => 100 + 60 * Math.sin(at / 4));
    const base = measured(dropped, perMinute(wavy));
    const [first] = replaySeries(dropped, base, window);
    for (const amount of [10, 35, 80]) {
      const moved = spec({ ...dropped, condition: { ...dropped.condition, amount, for: '2m' } });
      const [server] = replaySeries(moved, base, window);
      const browser = replayUnder(first?.points ?? [], moved.condition, moved.every, window.to);
      expect({ key: '{}', labels: {}, ...browser }).toEqual(server as NonNullable<typeof server>);
    }
  });

  test('replays joined tests, and the browser agrees under another joiner', () => {
    const rows = Array.from({ length: 21 }, (_unused, at) => [
      at * minute,
      'checkout',
      at % 7 < 3 ? 0.05 : 0.01,
      at % 5 < 3 ? 200 : 10,
    ]) as [number, string, number, number][];
    const short = { from: 0, to: 20 * minute, stepMs: minute };
    const one = spec({ ...busy, lookback: '1m' });
    const read = measure([shares(rows)], one);
    const [server] = replaySeries(one, read, short);
    expect(server?.firings).toBeGreaterThan(0);
    expect(server?.points[0]?.readings).toEqual([{ value: 0.05 }, { value: 200 }]);
    const any = spec({ ...one, condition: { ...one.condition, kind: 'any' } });
    const [expected] = replaySeries(any, read, short);
    const browser = replayUnder(server?.points ?? [], any.condition, any.every, short.to);
    expect(browser.firing).toEqual(expected?.firing ?? []);
    expect(browser.firingMs).toBeGreaterThan(server?.firingMs ?? 0);
  });
});
