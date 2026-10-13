import { describe, expect, test } from 'bun:test';
import { replayAlert } from './replay.ts';
import { runEvaluationQueries } from './run-query.ts';
import { fakeEngine, frameOf, minute, seriesFrame, spec } from './test/fixtures.ts';

const day = 24 * 60 * minute;

describe('replaying an alert over a past window', () => {
  test('runs one range query at the step, from one window before the start', async () => {
    const instant = spec({
      query: { refId: 'A', connector: 'prometheus', language: 'promql', expr: 'up', instant: true },
    });
    const engine = fakeEngine(() => [seriesFrame({}, [[day, 9]])]);
    const replay = await replayAlert(engine, instant, {
      from: day,
      to: day + 30 * minute,
      step: '5m',
    });
    const [request] = engine.requests;
    expect(request?.template).toMatchObject({ language: 'promql', step: '5m' });
    expect(request?.template).not.toHaveProperty('instant');
    expect(request?.timeRange.from.getTime()).toBe(day - 10 * minute);
    expect(replay).toMatchObject({ replayable: true, stepMs: 5 * minute, truncated: false });
  });

  test('says why a result without times cannot be replayed', async () => {
    const table = frameOf(
      [
        { name: 'service', type: 'string' },
        { name: 'errors', type: 'number' },
      ],
      [['checkout'], [3]],
    );
    const engine = fakeEngine(() => [table]);
    const replay = await replayAlert(engine, spec(), { from: 0, to: day });
    expect(replay.replayable).toBe(false);
    expect(replay).toMatchObject({ reason: expect.stringContaining('no time column') });
  });

  test('refuses a window that runs backwards, is too long or has too many steps', async () => {
    const engine = fakeEngine(() => []);
    await expect(replayAlert(engine, spec(), { from: day, to: 0 })).rejects.toThrow('ends before');
    await expect(replayAlert(engine, spec(), { from: 0, to: 40 * day })).rejects.toThrow('31 days');
    await expect(replayAlert(engine, spec(), { from: 0, to: 30 * day })).rejects.toThrow(
      'too many',
    );
  });

  test('fails as the source failed', async () => {
    const engine = fakeEngine(() => new Error('Prometheus is down.'));
    await expect(replayAlert(engine, spec(), { from: 0, to: day })).rejects.toMatchObject({
      code: 'source_failed',
    });
  });
});

describe("the interval of an alert's query", () => {
  const sql =
    'SELECT date_bin(:__interval::interval, at, :__from) AS time, count(*) AS errors FROM logs ' +
    'WHERE at BETWEEN :__from AND :__to GROUP BY 1';
  const bucketed = (lookback: string) =>
    spec({ query: { refId: 'A', connector: 'logs', language: 'sql', sql }, lookback });

  test('is the one its lookback takes, in a check and in a replay over a week alike', async () => {
    const engine = fakeEngine(() => [seriesFrame({}, [[day, 9]])]);
    await runEvaluationQueries(engine, bucketed('10m'), day);
    await replayAlert(engine, bucketed('10m'), { from: day, to: 8 * day, step: '5m' });
    expect(engine.requests.map((request) => request.interval)).toEqual(['1m', '1m']);
  });

  test('follows a longer lookback', async () => {
    const engine = fakeEngine(() => [seriesFrame({}, [[day, 9]])]);
    await runEvaluationQueries(engine, bucketed('1d'), 2 * day);
    expect(engine.requests[0]?.interval).toBe('10m');
  });

  test('is not given to a PromQL query, which a replay reads at the evaluation step', async () => {
    const engine = fakeEngine(() => [seriesFrame({}, [[day, 9]])]);
    await runEvaluationQueries(engine, spec(), day);
    await replayAlert(engine, spec(), { from: day, to: 2 * day });
    expect(engine.requests.map((request) => request.interval)).toEqual([undefined, undefined]);
    expect(engine.requests[1]?.template).toMatchObject({ step: '1m' });
  });
});
