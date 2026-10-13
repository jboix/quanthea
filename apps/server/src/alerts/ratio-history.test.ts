import { describe, expect, test } from 'bun:test';
import { alertSpecSchema, type Frame, notificationValues } from '@quanthea/shared';
import { observe } from './observe.ts';
import { replayAlert } from './replay.ts';
import { runEvaluationQueries } from './run-query.ts';
import { fakeEngine, frameOf, minute, seriesFrame, spec, specInput } from './test/fixtures.ts';

const hour = 60 * minute;
const checkout = { service: 'checkout' };
const key = '{service="checkout"}';

/** The second query: the requests of each service, on another connector. */
const requests = { refId: 'B', connector: 'warehouse', language: 'promql', expr: 'requests' };

/** 30% or more above the same window an hour earlier, read from the errors. */
const errorsRose = {
  kind: 'past',
  direction: 'up',
  amount: 30,
  unit: 'percent',
  ago: '1h',
  field: 'errors',
};

/**
 * The error share above 5%, with the errors themselves well above an hour earlier: a ratio joined
 * with a test that reads the history of the first query alone.
 */
const shareAndRise = {
  dividedBy: { query: requests },
  value: { field: 'errors' },
  lookback: '10m',
  condition: {
    kind: 'all',
    of: [{ kind: 'threshold', op: 'above', value: 0.05 }, errorsRose],
    for: '0m',
  },
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
 * The frame of the errors of checkout.
 *
 * @param points - The points, as time and count.
 * @returns The frame, with the count in a column named `errors`.
 */
function errors(points: readonly (readonly [number, number])[]): Frame {
  const fields = [
    { name: 'time', type: 'time' as const },
    { name: 'errors', type: 'number' as const, labels: checkout },
  ];
  return frameOf(fields, [points.map(([at]) => at), points.map(([, count]) => count)]);
}

/**
 * An engine with a point a minute: 100 requests on the second connector, and 10 errors on the
 * first, 20 from minute 170 on.
 *
 * @returns The engine.
 */
function engine() {
  return fakeEngine((request) => {
    const second = connectorOf(request) === 'warehouse';
    const points: [number, number][] = [];
    const last = Math.floor(request.timeRange.to.getTime() / minute);
    for (let at = Math.ceil(request.timeRange.from.getTime() / minute); at <= last; at += 1)
      points.push([at * minute, second ? 100 : at >= 170 ? 20 : 10]);
    return [second ? seriesFrame(checkout, points) : errors(points)];
  });
}

describe('a ratio joined with a test that reads history', () => {
  test('is a valid spec only while that test reads a column of the first query', () => {
    expect(alertSpecSchema.safeParse(specInput(shareAndRise)).success).toBe(true);
    const { field: _field, ...onRatio } = errorsRose;
    const refused = alertSpecSchema.safeParse(
      specInput({
        ...shareAndRise,
        condition: { ...shareAndRise.condition, of: [shareAndRise.condition.of[0], onRatio] },
      }),
    );
    expect(refused.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'condition.of.1.kind',
    ]);
  });

  test('runs three queries: both sides over the window, and the first a period back', async () => {
    const source = engine();
    await runEvaluationQueries(source, spec(shareAndRise), 3 * hour);
    const asked = source.requests.map((request) => [
      connectorOf(request),
      request.timeRange.from.getTime() / minute,
      request.timeRange.to.getTime() / minute,
    ]);
    expect(asked).toEqual([
      ['prometheus', 170, 180],
      ['warehouse', 170, 180],
      ['prometheus', 110, 120],
    ]);
  });

  test('reads the ratio for the first test and the undivided column for the other', async () => {
    const subject = spec(shareAndRise);
    const outcome = await runEvaluationQueries(engine(), subject, 3 * hour);
    if ('error' in outcome) throw new Error(outcome.error);
    const frames = {
      frames: [...outcome.frames],
      divisor: [...(outcome.divisor ?? [])],
      history: [...(outcome.history ?? [])],
    };
    const observation = observe(subject, frames, new Map()).series.get(key)?.observation;
    expect(observation).toEqual({
      kind: 'value',
      value: 0.2,
      holds: true,
      readings: [
        { value: 0.2, numerator: 20, denominator: 100 },
        { value: 20, reference: 10 },
      ],
    });
    const readings = observation?.kind === 'value' ? observation.readings : undefined;
    const values = notificationValues(
      subject,
      { labels: checkout, value: 0.2, since: 0, readings },
      'https://quanthea.example/alerts/1',
    );
    expect(values).toMatchObject({
      threshold: 'above 0.05 and errors up 30% or more from an hour earlier',
      values: '0.2, errors 20',
      change: '+100%',
      previous: '10',
      numerator: '20',
      denominator: '100',
    });
  });

  test('replays as it evaluates: quiet while the errors are level, firing once they rise', async () => {
    const replay = await replayAlert(engine(), spec(shareAndRise), {
      from: 2 * hour,
      to: 3 * hour,
    });
    if (!replay.replayable) throw new Error(replay.reason);
    expect(replay.series[0]?.firing).toEqual([{ from: 170 * minute, to: 3 * hour, ongoing: true }]);
  });
});
