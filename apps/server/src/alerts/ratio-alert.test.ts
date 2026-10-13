import { describe, expect, test } from 'bun:test';
import { type Frame, notificationValues, replayUnder } from '@quanthea/shared';
import { checkAlert } from './check.ts';
import { queriesPerEvaluation } from './history.ts';
import { observe } from './observe.ts';
import { replayAlert } from './replay.ts';
import { runEvaluationQueries } from './run-query.ts';
import { fakeEngine, frameOf, minute, seriesFrame, spec, specInput } from './test/fixtures.ts';

const hour = 60 * minute;
const none = new Map<string, Record<string, string>>();
const checkout = { service: 'checkout' };
const cart = { service: 'cart' };

/** The second query: the requests of each service, on another connector. */
const requests = {
  refId: 'B',
  connector: 'warehouse',
  language: 'promql',
  expr: 'sum by (service) (rate(http_requests_total{env="$env"}[1m]))',
};

/** The errors of each service as a share of its requests, above 5% at once. */
const share = {
  dividedBy: { query: requests },
  condition: { kind: 'threshold', op: 'above', value: 0.05, for: '0m' },
};

/**
 * The connector a request of the fake engine is for.
 *
 * @param request - The request.
 * @param request.template - Its query.
 * @returns The connector's name.
 */
function connectorOf(request: { readonly template: object }): string {
  return (request.template as { readonly connector: string }).connector;
}

/**
 * What an evaluation observes of each series, by key.
 *
 * @param subject - The spec.
 * @param frames - The frames of the first query.
 * @param divisor - The frames of the second query.
 * @returns The observations.
 */
function observed(subject: ReturnType<typeof spec>, frames: Frame[], divisor: Frame[]) {
  const { series } = observe(subject, { frames, divisor }, none);
  return Object.fromEntries([...series].map(([key, each]) => [key, each.observation]));
}

describe('the queries of a ratio', () => {
  test('run one after the other over the same window, each on its own connector', async () => {
    const engine = fakeEngine(() => []);
    await runEvaluationQueries(engine, spec(share), hour);
    expect(engine.requests.map(connectorOf)).toEqual(['prometheus', 'warehouse']);
    const [first, second] = engine.requests.map(({ timeRange }) => timeRange);
    expect<unknown>(second).toEqual(first);
    expect(first?.to.getTime()).toBe(hour);
    expect<unknown>(engine.requests[1]?.variables).toEqual(engine.requests[0]?.variables);
    expect(engine.requests[1]?.variables).toHaveProperty('env');
  });

  test('fail the evaluation when the second fails, saying which', async () => {
    const engine = fakeEngine((request) =>
      connectorOf(request) === 'warehouse' ? new Error('Timed out.') : [],
    );
    expect(await runEvaluationQueries(engine, spec(share), hour)).toEqual({
      error: 'The second query: Timed out.',
    });
  });

  test('count on the connector each runs on', () => {
    const subject = spec(share);
    expect(queriesPerEvaluation(subject, 'prometheus')).toBe(1);
    expect(queriesPerEvaluation(subject, 'warehouse')).toBe(1);
    expect(queriesPerEvaluation(subject, 'other')).toBe(0);
    const same = spec({ ...share, dividedBy: { query: { ...requests, connector: 'prometheus' } } });
    expect(queriesPerEvaluation(same, 'prometheus')).toBe(2);
    expect(queriesPerEvaluation(spec(), 'prometheus')).toBe(1);
  });
});

describe('the value of a ratio', () => {
  test('is the first query divided by the second, series by series', () => {
    const errors = [seriesFrame(checkout, [[0, 12]]), seriesFrame(cart, [[0, 1]])];
    const totals = [seriesFrame(checkout, [[0, 120]]), seriesFrame(cart, [[0, 100]])];
    expect(observed(spec(share), errors, totals)).toEqual({
      '{service="cart"}': {
        kind: 'value',
        value: 0.01,
        holds: false,
        readings: [{ value: 0.01, numerator: 1, denominator: 100 }],
      },
      '{service="checkout"}': {
        kind: 'value',
        value: 0.1,
        holds: true,
        readings: [{ value: 0.1, numerator: 12, denominator: 120 }],
      },
    });
  });

  test('reduces both sides the same way before it divides', () => {
    const subject = spec({ ...share, value: { reduce: 'sum' } });
    const errors = [
      seriesFrame(checkout, [
        [0, 4],
        [minute, 8],
      ]),
    ];
    const totals = [
      seriesFrame(checkout, [
        [0, 100],
        [minute, 20],
      ]),
    ];
    expect(observed(subject, errors, totals)['{service="checkout"}']).toMatchObject({
      value: 0.1,
      readings: [{ numerator: 12, denominator: 120 }],
    });
  });

  test('divides each series by the total that has fewer labels, or none', () => {
    const byCode = [
      seriesFrame({ service: 'checkout', code: '500' }, [[0, 6]]),
      seriesFrame({ service: 'checkout', code: '503' }, [[0, 3]]),
    ];
    const perService = observed(spec(share), byCode, [seriesFrame(checkout, [[0, 60]])]);
    expect<unknown>(Object.values(perService).map((each) => 'value' in each && each.value)).toEqual(
      [0.1, 0.05],
    );
    const overall = observed(spec(share), byCode, [seriesFrame({}, [[0, 600]])]);
    expect(overall['{code="500", service="checkout"}']).toMatchObject({ value: 0.01 });
  });

  test('has no value, and never holds, for a series the second query has no match for', () => {
    const errors = [seriesFrame(checkout, [[0, 12]])];
    const unmatched = { kind: 'value', value: null, holds: false };
    const readings = [{ value: null, numerator: 12, denominator: null }];
    expect<unknown>(observed(spec(share), errors, [seriesFrame(cart, [[0, 100]])])).toEqual({
      '{service="checkout"}': { ...unmatched, readings },
    });
    expect<unknown>(observed(spec(share), errors, [])).toEqual({
      '{service="checkout"}': { ...unmatched, readings },
    });
    const byRegion = [
      seriesFrame({ service: 'checkout', region: 'eu' }, [[0, 50]]),
      seriesFrame({ service: 'checkout', region: 'us' }, [[0, 70]]),
    ];
    expect(observed(spec(share), errors, byRegion)['{service="checkout"}']).toMatchObject(
      unmatched,
    );
  });

  test('has only the series of the first query: a total alone is not a series', () => {
    const totals = [seriesFrame(checkout, [[0, 120]]), seriesFrame(cart, [[0, 100]])];
    expect(Object.keys(observed(spec(share), [seriesFrame(cart, [[0, 9]])], totals))).toEqual([
      '{service="cart"}',
    ]);
  });

  test('is 0 over a total of 0, so it fires below a number unless it reads no value', () => {
    const errors = [seriesFrame(checkout, [[0, 0]])];
    const idle = [seriesFrame(checkout, [[0, 0]])];
    expect(observed(spec(share), errors, idle)['{service="checkout"}']).toMatchObject({
      value: 0,
      holds: false,
    });
    const below = { kind: 'threshold', op: 'below', value: 0.9, for: '0m' };
    expect(
      observed(spec({ ...share, condition: below }), errors, idle)['{service="checkout"}'],
    ).toMatchObject({ value: 0, holds: true });
    const silent = spec({
      condition: below,
      dividedBy: { query: requests, whenZero: 'no_value' },
    });
    expect(observed(silent, errors, idle)['{service="checkout"}']).toEqual({
      kind: 'value',
      value: null,
      holds: false,
      readings: [{ value: null, numerator: 0, denominator: 0 }],
    });
  });

  test('reads the column the spec names of the second query, and says when it is not there', () => {
    const totals = frameOf(
      [
        { name: 'time', type: 'time' },
        { name: 'service', type: 'string' },
        { name: 'sampled', type: 'number' },
        { name: 'requests', type: 'number' },
      ],
      [[0], ['checkout'], [1], [240]],
    );
    const errors = [seriesFrame(checkout, [[0, 12]])];
    const named = spec({ ...share, dividedBy: { query: requests, field: 'requests' } });
    expect(observed(named, errors, [totals])['{service="checkout"}']).toMatchObject({
      value: 0.05,
    });
    const wrong = spec({ ...share, dividedBy: { query: requests, field: 'hits' } });
    expect(observed(wrong, errors, [totals])).toEqual({
      '': { kind: 'error', message: 'The second query: No column "hits".' },
    });
  });
});

describe('a condition on a ratio', () => {
  /** The share rose by half or more within 2 minutes. */
  const rose = {
    kind: 'change',
    direction: 'up',
    amount: 50,
    unit: 'percent',
    within: '2m',
    for: '0m',
  };

  test('as a change divides the latest points and the earlier points, each side by its own', () => {
    const errors = [
      seriesFrame(checkout, [
        [0, 5],
        [3 * minute, 30],
      ]),
    ];
    const totals = [
      seriesFrame(checkout, [
        [0, 100],
        [3 * minute, 200],
      ]),
    ];
    expect(observed(spec({ ...share, condition: rose }), errors, totals)).toEqual({
      '{service="checkout"}': {
        kind: 'value',
        value: 0.15,
        holds: true,
        readings: [{ value: 0.15, reference: 0.05, numerator: 30, denominator: 200 }],
      },
    });
    const flat = [seriesFrame(checkout, [[3 * minute, 200]])];
    expect(
      observed(spec({ ...share, condition: rose }), errors, flat)['{service="checkout"}'],
    ).toMatchObject({ holds: false, readings: [{ reference: null }] });
  });

  test('joined: a part without a field reads the ratio, a part with one the first query', () => {
    const busy = {
      kind: 'all',
      of: [
        { kind: 'threshold', op: 'above', value: 0.05 },
        { kind: 'threshold', op: 'above', value: 10, field: 'errors' },
      ],
      for: '0m',
    };
    const subject = spec({ ...share, condition: busy, value: { field: 'errors' } });
    const errors = (count: number) =>
      frameOf(
        [
          { name: 'time', type: 'time' },
          { name: 'errors', type: 'number', labels: checkout },
        ],
        [[0], [count]],
      );
    const totals = [seriesFrame(checkout, [[0, 100]])];
    expect(observed(subject, [errors(12)], totals)['{service="checkout"}']).toEqual({
      kind: 'value',
      value: 0.12,
      holds: true,
      readings: [{ value: 0.12, numerator: 12, denominator: 100 }, { value: 12 }],
    });
    expect(observed(subject, [errors(8)], totals)['{service="checkout"}']).toMatchObject({
      value: 0.08,
      holds: false,
    });
  });
});

describe('the replay of a ratio', () => {
  /**
   * An engine whose first query returns errors and whose second returns requests, a point a
   * minute: 20 errors from minute 130 to 140 and 2 otherwise, over 100 requests, none at 150.
   *
   * @param timed - Whether the second query returns its times.
   * @returns The engine.
   */
  function engineOf(timed = true) {
    const errorsAt = (at: number) => (at >= 130 && at <= 140 ? 20 : 2);
    const requestsAt = (at: number) => (at === 150 ? 0 : 100);
    return fakeEngine((request) => {
      const { timeRange } = request;
      const second = connectorOf(request) === 'warehouse';
      const valueAt = second ? requestsAt : errorsAt;
      const points: [number, number][] = [];
      const last = Math.floor(timeRange.to.getTime() / minute);
      for (let at = Math.ceil(timeRange.from.getTime() / minute); at <= last; at += 1)
        points.push([at * minute, valueAt(at)]);
      if (timed || !second) return [seriesFrame(checkout, points)];
      return [frameOf([{ name: 'Value', type: 'number', labels: checkout }], [[100]])];
    });
  }

  test('reads each query once over the window, and fires where the ratio held', async () => {
    const engine = engineOf();
    const replay = await replayAlert(engine, spec(share), { from: 2 * hour, to: 3 * hour });
    if (!replay.replayable) throw new Error(replay.reason);
    expect(engine.requests.map(connectorOf)).toEqual(['prometheus', 'warehouse']);
    const [series] = replay.series;
    expect(series?.firing).toEqual([{ from: 130 * minute, to: 141 * minute, ongoing: false }]);
    expect(series?.points.find((point) => point.at === 150 * minute)).toEqual({
      at: 150 * minute,
      value: 0,
      readings: [{ value: 0, numerator: 2, denominator: 0 }],
    });
  });

  test('gives each step what an evaluation then would have read', async () => {
    const engine = engineOf();
    const subject = spec(share);
    const replay = await replayAlert(engine, subject, { from: 2 * hour, to: 3 * hour });
    if (!replay.replayable) throw new Error(replay.reason);
    for (const at of [2 * hour, 130 * minute, 141 * minute, 150 * minute, 3 * hour]) {
      const outcome = await runEvaluationQueries(engine, subject, at);
      if ('error' in outcome) throw new Error(outcome.error);
      const evaluated = observed(subject, [...outcome.frames], [...(outcome.divisor ?? [])]);
      const point = replay.series[0]?.points.find((each) => each.at === at);
      expect(point).toBeDefined();
      expect(evaluated['{service="checkout"}']).toMatchObject({
        value: point?.value ?? null,
        readings: point?.readings ?? [],
      });
    }
  });

  test('says why when the second query has no times', async () => {
    const replay = await replayAlert(engineOf(false), spec(share), {
      from: 2 * hour,
      to: 3 * hour,
    });
    expect(replay).toEqual({
      replayable: false,
      reason: expect.stringContaining('The second query returns no time column'),
    });
  });

  test('judged again in the browser keeps a series without a match as seen, not as missing', () => {
    const condition = { kind: 'threshold', op: 'above', value: 0.05, for: '0m' } as const;
    const points = [
      { at: 0, value: 0.1, readings: [{ value: 0.1, numerator: 10, denominator: 100 }] },
      { at: minute, value: null, readings: [{ value: null, numerator: 10, denominator: null }] },
      { at: 2 * minute, value: null },
    ];
    const track = replayUnder(points, condition, '1m', 2 * minute);
    expect(track.firing).toEqual([{ from: 0, to: minute, ongoing: false }]);
  });
});

describe('the check of a ratio before a save', () => {
  const guardrails = { timeoutMs: 1000, maxRows: 1000, maxRangeDays: 31 };
  const lookup = () => ({ language: 'promql' as const, guardrails });
  const errors = [seriesFrame(checkout, [[0, 12]])];

  test('runs both queries and says what the ratio is now', async () => {
    const engine = fakeEngine((request) =>
      connectorOf(request) === 'warehouse' ? [seriesFrame(checkout, [[0, 120]])] : errors,
    );
    expect(await checkAlert({ ...engine, lookup }, specInput(share), hour)).toMatchObject({
      ok: true,
      series: [{ key: '{service="checkout"}', value: 0.1, holds: true }],
    });
    expect(engine.requests).toHaveLength(2);
  });

  test('refuses a second query none of whose series matches', async () => {
    const engine = fakeEngine((request) =>
      connectorOf(request) === 'warehouse' ? [seriesFrame(cart, [[0, 120]])] : errors,
    );
    expect(await checkAlert({ ...engine, lookup }, specInput(share), hour)).toEqual({
      ok: false,
      issues: [{ path: 'dividedBy', message: expect.stringContaining('No series of the query') }],
    });
  });

  test('says nothing about matches while the first query returns no series', async () => {
    const engine = fakeEngine(() => []);
    expect(await checkAlert({ ...engine, lookup }, specInput(share), hour)).toMatchObject({
      ok: true,
      series: [],
    });
  });

  test('checks each query against its own connector', async () => {
    const short = { ...guardrails, maxRangeDays: 1 };
    const byName = (name: string) =>
      name === 'gone'
        ? undefined
        : { language: 'promql' as const, guardrails: name === 'warehouse' ? short : guardrails };
    const engine = fakeEngine(() => errors);
    const long = specInput({ ...share, lookback: '3d' });
    const refused = await checkAlert({ ...engine, lookup: byName }, long, 10 * 24 * hour);
    expect(refused).toMatchObject({ ok: false, issues: [{ path: 'lookback' }] });
    const missing = specInput({ dividedBy: { query: { ...requests, connector: 'gone' } } });
    const unknown = await checkAlert({ ...engine, lookup: byName }, missing, hour);
    expect(unknown).toMatchObject({ ok: false, issues: [{ path: 'dividedBy.query.connector' }] });
    expect(engine.requests).toHaveLength(0);
  });
});

describe('the message of a ratio', () => {
  test('can name both sides, with plain digits whatever the format of the ratio', () => {
    const subject = spec({ ...share, value: { format: { $fmt: 'percent', decimals: 1 } } });
    const readings = [{ value: 0.025, numerator: 12, denominator: 480 }];
    const series = { labels: checkout, value: 0.025, since: 0, readings };
    expect(notificationValues(subject, series, 'https://quanthea.test/a')).toMatchObject({
      value: '2.5%',
      numerator: '12',
      denominator: '480',
      threshold: 'above 5%',
    });
    const plain = notificationValues(spec(), { labels: checkout, value: 7, since: 0 }, '');
    expect(plain).toMatchObject({ numerator: '', denominator: '' });
  });
});
