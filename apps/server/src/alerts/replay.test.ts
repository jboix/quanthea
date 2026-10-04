import { describe, expect, test } from 'bun:test';
import { replayAlert } from './replay.ts';
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
