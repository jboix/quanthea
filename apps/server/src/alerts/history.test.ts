import { describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/shared';
import { checkAlert } from './check.ts';
import { historyBefore, historyWindowAt } from './history.ts';
import { observe } from './observe.ts';
import { replayAlert } from './replay.ts';
import { runEvaluationQueries } from './run-query.ts';
import { fakeEngine, minute, seriesFrame, spec, specInput } from './test/fixtures.ts';

const hour = 60 * minute;
const day = 24 * hour;
const none = new Map<string, Record<string, string>>();
const checkout = { service: 'checkout' };

/** 30% or more above the same window a week earlier. */
const aboveLastWeek = {
  kind: 'past',
  direction: 'up',
  amount: 30,
  unit: 'percent',
  ago: '7d',
  for: '0m',
};

/** More than 3 deviations from the mean of the hour before the window. */
const outsideBand = { kind: 'band', side: 'either', deviations: 3, baseline: '1h', for: '0m' };

/**
 * The frame of one series with a point a minute.
 *
 * @param from - The first minute.
 * @param to - The last minute.
 * @param valueAt - The value at a minute.
 * @param labels - The labels.
 * @returns The frame.
 */
function minutes(
  from: number,
  to: number,
  valueAt: (at: number) => number,
  labels: Record<string, string> = checkout,
): Frame {
  const points: [number, number][] = [];
  for (let at = from; at <= to; at += 1) points.push([at * minute, valueAt(at)]);
  return seriesFrame(labels, points);
}

/**
 * What an evaluation observes of the checkout series.
 *
 * @param subject - The spec.
 * @param frames - The frames of the window.
 * @param history - The frames of the history query.
 * @returns The observation.
 */
function observed(subject: ReturnType<typeof spec>, frames: Frame[], history: Frame[]) {
  return observe(subject, { frames, history }, none).series.get('{service="checkout"}')
    ?.observation;
}

describe('the history an evaluation reads', () => {
  test('is the same window a period back for a comparison with the past', async () => {
    const subject = spec({ condition: aboveLastWeek });
    const engine = fakeEngine(() => []);
    await runEvaluationQueries(engine, subject, 10 * day);
    const ranges = engine.requests.map(({ timeRange }) => [
      timeRange.from.getTime(),
      timeRange.to.getTime(),
    ]);
    expect(ranges).toEqual([
      [10 * day - 10 * minute, 10 * day],
      [3 * day - 10 * minute, 3 * day],
    ]);
    expect(engine.requests[1]?.template).toEqual(subject.query);
  });

  test('is the baseline before the window for a band, never an instant query', async () => {
    const query = { refId: 'A', connector: 'prometheus', language: 'promql', expr: 'up' };
    const subject = spec({ condition: outsideBand, query: { ...query, instant: true } });
    const engine = fakeEngine(() => []);
    await runEvaluationQueries(engine, subject, day);
    expect(historyWindowAt(subject, day)).toEqual({
      from: day - 70 * minute,
      to: day - 10 * minute,
    });
    expect(engine.requests[0]?.template).toHaveProperty('instant', true);
    expect(engine.requests[1]?.template).not.toHaveProperty('instant');
    expect(engine.requests[1]?.timeRange.from.getTime()).toBe(day - 70 * minute);
  });

  test('is no query at all for the other kinds', async () => {
    const engine = fakeEngine(() => []);
    await runEvaluationQueries(engine, spec(), day);
    expect(engine.requests).toHaveLength(1);
    expect(historyWindowAt(spec(), day)).toBeUndefined();
  });

  test('fails the evaluation when its query fails', async () => {
    const subject = spec({ condition: aboveLastWeek });
    const engine = fakeEngine((request) =>
      request.timeRange.to.getTime() === day ? [] : new Error('Too far back.'),
    );
    expect(await runEvaluationQueries(engine, subject, day)).toEqual({ error: 'Too far back.' });
  });
});

describe('a comparison with the past', () => {
  const subject = spec({ condition: aboveLastWeek, value: { reduce: 'mean' } });
  const now = [
    seriesFrame(checkout, [
      [0, 120],
      [minute, 140],
    ]),
  ];

  test('holds when the value of the window is far enough above the value then', () => {
    const then = [
      seriesFrame(checkout, [
        [0, 90],
        [minute, 110],
      ]),
    ];
    expect(observed(subject, now, then)).toEqual({
      kind: 'value',
      value: 130,
      holds: true,
      readings: [{ value: 130, reference: 100 }],
    });
    const close = [seriesFrame(checkout, [[0, 101]])];
    expect(observed(subject, now, close)).toMatchObject({ holds: false });
  });

  test('does not hold for a series that was not there then', () => {
    const others = [seriesFrame({ service: 'search' }, [[0, 1]])];
    expect(observed(subject, now, others)).toEqual({
      kind: 'value',
      value: 130,
      holds: false,
      readings: [{ value: 130, reference: null }],
    });
    expect(observed(subject, now, [])).toMatchObject({ holds: false });
  });

  test('leaves a series that is only in the past out of the result', () => {
    const gone = [seriesFrame({ service: 'legacy' }, [[0, 1]])];
    const { series } = observe(subject, { frames: now, history: gone }, none);
    expect([...series.keys()]).toEqual(['{service="checkout"}']);
  });

  test('as a share of a value of zero does not hold, as a difference it does', () => {
    const zero = [seriesFrame(checkout, [[0, 0]])];
    expect(observed(subject, now, zero)).toMatchObject({ holds: false });
    const absolute = spec({ condition: { ...aboveLastWeek, unit: 'absolute' } });
    expect(observed(absolute, now, zero)).toMatchObject({ holds: true });
  });

  test('below fires on a drop', () => {
    const down = spec({ condition: { ...aboveLastWeek, direction: 'down' } });
    const then = [seriesFrame(checkout, [[0, 400]])];
    expect(observed(down, now, then)).toMatchObject({ value: 140, holds: true });
  });
});

describe('a band', () => {
  const subject = spec({ condition: outsideBand });
  // An hour that goes 9, 11, 9, 11: a mean of 10 and a deviation of 1.
  const usual = [minutes(0, 59, (at) => (at % 2 === 0 ? 9 : 11))];
  const valued = (value: number) => [seriesFrame(checkout, [[70 * minute, value]])];

  test('holds outside the mean give or take the deviations, on the sides it names', () => {
    expect(observed(subject, valued(13.5), usual)).toEqual({
      kind: 'value',
      value: 13.5,
      holds: true,
      readings: [{ value: 13.5, reference: 10, spread: 1 }],
    });
    expect(observed(subject, valued(12.9), usual)).toMatchObject({ holds: false });
    expect(observed(subject, valued(6.5), usual)).toMatchObject({ holds: true });
    const above = spec({ condition: { ...outsideBand, side: 'above' } });
    expect(observed(above, valued(6.5), usual)).toMatchObject({ holds: false });
    const below = spec({ condition: { ...outsideBand, side: 'below' } });
    expect(observed(below, valued(13.5), usual)).toMatchObject({ holds: false });
    expect(observed(below, valued(6.5), usual)).toMatchObject({ holds: true });
  });

  test('gives no verdict with too little history, however far the value is', () => {
    const few = [minutes(51, 59, () => 10)];
    const young = [minutes(40, 59, () => 10)];
    for (const history of [few, young, []])
      expect(observed(subject, valued(1000), history)).toEqual({
        kind: 'value',
        value: 1000,
        holds: false,
        readings: [{ value: 1000, reference: null, spread: null }],
      });
  });

  test('joined with a threshold reads its history for its own part', () => {
    const { for: _for, ...band } = outsideBand;
    const joined = spec({
      condition: {
        kind: 'all',
        of: [{ kind: 'threshold', op: 'above', value: 12 }, band],
        for: '0m',
      },
    });
    expect(observed(joined, valued(13.5), usual)).toMatchObject({
      holds: true,
      readings: [{ value: 13.5 }, { value: 13.5, reference: 10, spread: 1 }],
    });
    expect(observed(joined, valued(6.5), usual)).toMatchObject({ holds: false });
  });
});

describe('replaying a condition that reads history', () => {
  test('reads the time before the replay once, and each step from the points', async () => {
    const subject = spec({ condition: { ...aboveLastWeek, ago: '1h' }, lookback: '1m' });
    // 100 for the first two hours, 150 from 02:30 on.
    const all = minutes(0, 180, (at) => (at >= 150 ? 150 : 100));
    const engine = fakeEngine(({ timeRange }) => {
      const [time, value] = all.values as [number[], number[]];
      const kept = time.flatMap((at, index): [number, number][] =>
        at >= timeRange.from.getTime() && at <= timeRange.to.getTime()
          ? [[at, value[index] ?? 0]]
          : [],
      );
      return [seriesFrame(checkout, kept)];
    });
    const replay = await replayAlert(engine, subject, { from: 2 * hour, to: 3 * hour });
    const ranges = engine.requests.map(({ timeRange }) => [
      timeRange.from.getTime() / minute,
      timeRange.to.getTime() / minute,
    ]);
    expect(ranges).toEqual([
      [59, 119 - 1 / minute],
      [119, 180],
    ]);
    if (!replay.replayable) throw new Error('not replayable');
    const [series] = replay.series;
    expect(series?.firing).toEqual([{ from: 150 * minute, to: 3 * hour, ongoing: true }]);
    expect(series?.points[0]).toEqual({
      at: 2 * hour,
      value: 100,
      readings: [{ value: 100, reference: 100 }],
    });
    expect(series?.points.at(-1)?.readings).toEqual([{ value: 150, reference: 100 }]);
  });

  test('reads no further back than its last step looks', () => {
    const subject = spec({ condition: aboveLastWeek });
    const span = { from: 10 * day, to: 11 * day };
    expect(historyBefore(subject, span)).toEqual({ from: 3 * day, to: 4 * day });
    expect(historyBefore(spec({ condition: outsideBand }), span)).toEqual({
      from: 10 * day - hour,
      to: 10 * day - 1,
    });
    expect(historyBefore(spec(), span)).toBeUndefined();
  });

  test('leaves out a series that only the time before has', async () => {
    const subject = spec({ condition: outsideBand });
    const engine = fakeEngine(({ timeRange }) =>
      timeRange.to.getTime() < 2 * hour - 10 * minute
        ? [minutes(60, 100, () => 1, { service: 'legacy' })]
        : [minutes(110, 180, () => 1)],
    );
    const replay = await replayAlert(engine, subject, { from: 2 * hour, to: 3 * hour });
    if (!replay.replayable) throw new Error('not replayable');
    expect(replay.series.map((each) => each.key)).toEqual(['{service="checkout"}']);
  });

  test('gives each step what an evaluation then would have read', async () => {
    const subject = spec({ condition: outsideBand });
    const valueAt = (at: number) => 10 + Math.sin(at / 7) + (at === 200 ? 9 : 0);
    const between = (from: number, to: number) => [
      minutes(Math.ceil(from / minute), Math.floor(to / minute), valueAt),
    ];
    const engine = fakeEngine(({ timeRange }) =>
      between(timeRange.from.getTime(), timeRange.to.getTime()),
    );
    const replay = await replayAlert(engine, subject, { from: 3 * hour, to: 4 * hour });
    if (!replay.replayable) throw new Error('not replayable');
    const [series] = replay.series;
    expect(series?.firings).toBe(1);
    for (const at of [3 * hour, 200 * minute, 205 * minute, 4 * hour]) {
      const outcome = await runEvaluationQueries(engine, subject, at);
      if ('error' in outcome) throw new Error(outcome.error);
      const evaluated = observed(subject, [...outcome.frames], [...(outcome.history ?? [])]);
      const replayed = series?.points.find((point) => point.at === at);
      if (evaluated?.kind !== 'value') throw new Error('no value');
      expect(replayed?.value).toBe(evaluated.value);
      expect(replayed?.readings?.[0]?.reference).toBeCloseTo(
        evaluated.readings?.[0]?.reference ?? Number.NaN,
        9,
      );
      expect(replayed?.readings?.[0]?.spread).toBeCloseTo(
        evaluated.readings?.[0]?.spread ?? Number.NaN,
        9,
      );
    }
  });
});

describe('the check before a save', () => {
  const guardrails = { timeoutMs: 1000, maxRows: 1000, maxRangeDays: 31 };
  const lookup = () => ({ language: 'promql' as const, guardrails });

  test('refuses a comparison with a time no series has a value for', async () => {
    const engine = fakeEngine(({ timeRange }) =>
      timeRange.to.getTime() === 10 * day ? [seriesFrame(checkout, [[10 * day, 5]])] : [],
    );
    const input = specInput({ condition: aboveLastWeek });
    expect(await checkAlert({ ...engine, lookup }, input, 10 * day)).toEqual({
      ok: false,
      issues: [
        { path: 'condition.ago', message: expect.stringContaining('No series has a value a week') },
      ],
    });
  });

  test('takes one that a series has a value for, and says whether it holds now', async () => {
    const engine = fakeEngine(({ timeRange }) => [
      seriesFrame(checkout, [[0, timeRange.to.getTime() === 10 * day ? 140 : 100]]),
    ]);
    const input = specInput({ condition: aboveLastWeek });
    expect(await checkAlert({ ...engine, lookup }, input, 10 * day)).toMatchObject({
      ok: true,
      series: [{ key: '{service="checkout"}', value: 140, holds: true }],
    });
    expect(engine.requests).toHaveLength(2);
  });

  test('says nothing about history while the query returns no series at all', async () => {
    const engine = fakeEngine(() => []);
    const input = specInput({ condition: outsideBand });
    expect(await checkAlert({ ...engine, lookup }, input, day)).toMatchObject({
      ok: true,
      series: [],
    });
  });
});
