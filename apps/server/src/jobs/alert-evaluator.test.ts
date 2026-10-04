import { describe, expect, test } from 'bun:test';
import type { EvaluatedAlert } from '../alerts/evaluate.ts';
import { fakeEngine, minute, spec } from '../alerts/test/fixtures.ts';
import type { AlertRow } from '../db/alert-repository.ts';
import { captureLogs } from '../test/fixtures.ts';
import { createAlertEvaluator, isDue } from './alert-evaluator.ts';

/**
 * An active alert on a connector.
 *
 * @param id - Its id.
 * @param connector - Its connector.
 * @param evaluatedAt - When it was last evaluated.
 * @returns The alert with its spec.
 */
function alertOn(id: string, connector: string, evaluatedAt: number | null = null): EvaluatedAlert {
  const query = { refId: 'A', connector, language: 'promql', expr: 'up' };
  const alert: AlertRow = {
    id,
    title: id,
    threadId: null,
    activeVersion: 1,
    latestVersion: 1,
    deactivatedAt: null,
    mutedAt: null,
    mutedBy: null,
    mutedUntil: null,
    evaluatedAt,
    createdBy: 'ada',
    createdAt: 0,
    updatedAt: 0,
  };
  return { alert, spec: spec({ query }) };
}

/**
 * An evaluator over fixed alerts, a clock and an evaluation that the test controls.
 *
 * @param alerts - The alerts.
 * @param evaluate - What evaluating one does.
 * @returns The evaluator, the clock and the logs.
 */
function evaluatorOver(
  alerts: () => EvaluatedAlert[],
  evaluate: (subject: EvaluatedAlert, now: number) => Promise<void>,
) {
  const clock = { now: 0 };
  const logs = captureLogs();
  const evaluation = {
    ...fakeEngine(() => []),
    states: { series: () => [], saveEvaluation: () => undefined },
    notify: () => Promise.resolve(),
    alertUrl: () => '',
  };
  const evaluator = createAlertEvaluator({
    alerts: { evaluated: alerts },
    evaluation,
    logger: logs.logger,
    evaluate: (_dependencies, subject, now) => evaluate(subject, now),
    caps: { global: 3, perKey: 2 },
    now: () => clock.now,
  });
  return { evaluator, clock, logs };
}

describe('when an alert is due', () => {
  test('never evaluated, or once its interval has passed', () => {
    expect(isDue(alertOn('a', 'p'), 0)).toBe(true);
    expect(isDue(alertOn('a', 'p', 0), 30_000)).toBe(false);
    expect(isDue(alertOn('a', 'p', 0), minute)).toBe(true);
  });

  test('after downtime: once, not once per missed interval', async () => {
    let evaluatedAt = 0;
    const seen: number[] = [];
    const { evaluator, clock } = evaluatorOver(
      () => [alertOn('a', 'p', evaluatedAt)],
      (_subject, now) => {
        seen.push(now);
        evaluatedAt = now;
        return Promise.resolve();
      },
    );
    clock.now = 60 * minute;
    await evaluator.tick();
    await evaluator.tick();
    expect(seen).toEqual([60 * minute]);
  });
});

describe('running evaluations', () => {
  test('holds to the cap per connector and the cap in all', async () => {
    const alerts = ['a', 'b', 'c', 'd'].map((id) => alertOn(id, 'prom'));
    alerts.push(alertOn('e', 'loki'), alertOn('f', 'loki'));
    const running = new Map<string, number>();
    let peak = { prom: 0, all: 0 };
    const releases: (() => void)[] = [];
    let started = 0;
    const { evaluator } = evaluatorOver(
      () => alerts,
      (subject) => {
        started += 1;
        const connector = subject.spec.query.connector;
        running.set(connector, (running.get(connector) ?? 0) + 1);
        const all = [...running.values()].reduce((sum, each) => sum + each, 0);
        peak = {
          prom: Math.max(peak.prom, running.get('prom') ?? 0),
          all: Math.max(peak.all, all),
        };
        return new Promise((resolve) =>
          releases.push(() => {
            running.set(connector, (running.get(connector) ?? 1) - 1);
            resolve();
          }),
        );
      },
    );
    const tick = evaluator.tick();
    // Finish one evaluation at a time, so each waiting one starts as room frees up.
    while (started < alerts.length || releases.length > 0) {
      await Bun.sleep(1);
      releases.shift()?.();
    }
    await tick;
    expect(started).toBe(6);
    expect(peak).toEqual({ prom: 2, all: 3 });
  });

  test('skips an alert whose evaluation is still running', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const { evaluator } = evaluatorOver(
      () => [alertOn('a', 'p')],
      () => {
        calls += 1;
        return new Promise((resolve) => {
          release = () => resolve();
        });
      },
    );
    const first = evaluator.tick();
    await evaluator.tick();
    release();
    await first;
    expect(calls).toBe(1);
  });

  test('never lets one failing alert stop the others', async () => {
    const evaluated: string[] = [];
    const { evaluator, logs } = evaluatorOver(
      () => [alertOn('broken', 'p'), alertOn('fine', 'p')],
      (subject) => {
        if (subject.alert.id === 'broken') return Promise.reject(new Error('boom'));
        evaluated.push(subject.alert.id);
        return Promise.resolve();
      },
    );
    await evaluator.tick();
    expect(evaluated).toEqual(['fine']);
    expect(logs.lines).toMatchObject([
      { message: 'an alert evaluation failed', alertId: 'broken' },
    ]);
  });
});
