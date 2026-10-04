import { describe, expect, test } from 'bun:test';
import { type AlertSpec, alertSpecSchema } from '@quanthea/shared';
import { type AlertExpectation, alertCases } from './alert-cases.ts';
import {
  type AlertCaseOutcome,
  conditionWords,
  isAlert,
  type ReplayedSeriesSummary,
  scoreAlert,
} from './alert-score.ts';
import { htmlReport, markdownReport } from './render.ts';
import { scoreAll } from './report.ts';

/**
 * A case's expectation, by id.
 *
 * @param id - The case's id.
 * @returns Its expectation.
 */
function expectationOf(id: string): AlertExpectation {
  const found = alertCases.find((each) => each.id === id);
  if (!found) throw new Error(`No case ${id}.`);
  return found.expect;
}

/** Deploy #481, at 12:02 UTC on the day before the fixed clock. */
const incidentAt = Date.UTC(2026, 9, 3, 12, 2);

/** A minute, in milliseconds. */
const minute = 60_000;

const errorShare =
  'sum by (service) (rate(http_requests_total{env="prod",code=~"5.."}[1m])) / sum by (service) (rate(http_requests_total{env="prod"}[1m]))';

/**
 * A spec as the agent would save it for al1, with some fields replaced.
 *
 * @param overrides - Fields to replace.
 * @returns The parsed spec.
 */
function specWith(overrides: Record<string, unknown> = {}): AlertSpec {
  return alertSpecSchema.parse({
    specVersion: 1,
    title: 'Checkout 5xx share',
    query: { refId: 'A', connector: 'prometheus-dev', language: 'promql', expr: errorShare },
    value: { reduce: 'last', format: { $fmt: 'percent', decimals: 1 } },
    variables: [],
    condition: { kind: 'threshold', op: 'above', value: 0.02, for: '5m' },
    every: '1m',
    lookback: '10m',
    severity: 'critical',
    channels: ['channel-1'],
    notify: { onResolved: true },
    message: { title: '{alert}: {series} at {value}', body: 'Above {threshold} since {since}.' },
    ...overrides,
  });
}

/**
 * A series of a replay that fired at these minutes after the deploy.
 *
 * @param service - The service label.
 * @param starts - The minutes after the deploy each firing starts.
 * @returns The series.
 */
function series(service: string, ...starts: number[]): ReplayedSeriesSummary {
  const firing = starts.map((start) => ({
    from: incidentAt + start * minute,
    to: incidentAt + (start + 20) * minute,
    ongoing: false,
  }));
  return { labels: { service }, firing, tooShort: 0 };
}

const written: AlertCaseOutcome = {
  kind: 'alert',
  id: 'al1',
  spec: specWith(),
  versions: 1,
  channelIds: ['channel-1'],
  incidentAt,
  replay: {
    replayable: true,
    series: [series('checkout-svc', 9), series('payments-svc', 12), series('cart-svc')],
  },
  toolCalls: { describe: 1, propose_alert: 1, edit_alert: 1, replay_alert: 1 },
  said: 'Over the last day it would have fired once, at the checkout incident.',
  asked: [],
  repairs: 0,
  turns: 2,
  usage: {},
  durationMs: 9000,
};

const unreplayed: AlertCaseOutcome = {
  ...written,
  id: 'al2',
  toolCalls: { describe: 1, propose_alert: 1, edit_alert: 1 },
  said: 'I cannot read a replay at this access level; the draft pane shows how it would fire.',
};

const waited: AlertCaseOutcome = {
  ...written,
  id: 'al3',
  spec: specWith({ condition: { kind: 'threshold', op: 'above', value: 0.02, for: '10m' } }),
  replay: { replayable: true, series: [series('checkout-svc', 14)] },
};

const fromPanel: AlertCaseOutcome = {
  ...written,
  id: 'al4',
  spec: specWith({ condition: { kind: 'threshold', op: 'above', value: 0.03, for: '0m' } }),
  panel: { panel: 'fingerprint', alert: 'fingerprint', links: ['from_panel'] },
};

describe('scoring an alert case', () => {
  test('passes a good alert of each case', () => {
    expect(scoreAlert(written, expectationOf('al1'))).toEqual({ pass: true, reasons: [] });
    expect(scoreAlert(unreplayed, expectationOf('al2'))).toEqual({ pass: true, reasons: [] });
    expect(scoreAlert(waited, expectationOf('al3'))).toEqual({ pass: true, reasons: [] });
    expect(scoreAlert(fromPanel, expectationOf('al4'))).toEqual({ pass: true, reasons: [] });
  });

  test('accepts a threshold in percent when the query is scaled to percent', () => {
    const scaled = specWith({
      query: { ...written.spec?.query, expr: `100 * ${errorShare}` },
      condition: { kind: 'threshold', op: 'above', value: 2, for: '300s' },
    });
    expect(scoreAlert({ ...written, spec: scaled }, expectationOf('al1')).pass).toBe(true);
  });

  test('fails a run that failed, or a thread that saved no version, before anything else', () => {
    const failed = { ...written, error: 'quota spent' };
    expect(scoreAlert(failed, expectationOf('al1')).reasons).toEqual([
      'the run failed: quota spent',
    ]);
    const { spec: _spec, ...unsaved } = written;
    expect(scoreAlert(unsaved, expectationOf('al1')).reasons).toEqual([
      'no alert version was saved',
    ]);
  });

  test('fails the wrong connector, direction, threshold or wait', () => {
    const wrong = specWith({
      query: { refId: 'A', connector: 'postgres-orders', language: 'sql', sql: 'SELECT 1' },
      condition: { kind: 'threshold', op: 'below', value: 2, for: '1m' },
    });
    expect(scoreAlert({ ...written, spec: wrong }, expectationOf('al1')).reasons).toEqual([
      'the query runs on postgres-orders, expected prometheus-dev',
      'the condition fires below, not above',
      'the threshold is 2, expected 0.02',
      'the condition holds for 1m, expected 5m',
      'the alert neither tells services apart nor keeps to checkout',
    ]);
    const silent = specWith({ condition: { kind: 'no_data', for: '5m' } });
    expect(scoreAlert({ ...written, spec: silent }, expectationOf('al1')).reasons).toEqual([
      'the condition is not a threshold',
    ]);
  });

  test('fails a message that names neither the alert nor the value, or an unknown channel', () => {
    const spec = specWith({
      message: { title: 'Checkout errors', body: 'Look at {link}.' },
      channels: ['made-up'],
    });
    expect(scoreAlert({ ...written, spec }, expectationOf('al1')).reasons).toEqual([
      'the message names neither {alert} nor {value}',
      'the alert names unknown channels: made-up',
    ]);
  });

  test('fails a replay that is missing, failed, or has no checkout series', () => {
    const { replay: _replay, ...unreplayedSpec } = written;
    expect(scoreAlert(unreplayedSpec, expectationOf('al1')).reasons).toEqual([
      'the saved version was not replayed',
    ]);
    const failed = {
      ...written,
      replay: { replayable: false as const, reason: 'No time column.' },
    };
    expect(scoreAlert(failed, expectationOf('al1')).reasons).toEqual([
      'the replay failed: No time column.',
    ]);
    const elsewhere = {
      ...written,
      replay: { replayable: true as const, series: [series('cart')] },
    };
    expect(scoreAlert(elsewhere, expectationOf('al1')).reasons).toEqual([
      'the replay has no checkout series',
    ]);
  });

  test('fails checkout firing twice, or long after the deploy', () => {
    const twice = { replayable: true as const, series: [series('checkout-svc', 9, 40)] };
    expect(scoreAlert({ ...written, replay: twice }, expectationOf('al1')).reasons).toEqual([
      'checkout fired 2 times over yesterday, expected once',
    ]);
    const late = { replayable: true as const, series: [series('checkout-svc', 45)] };
    expect(scoreAlert({ ...written, replay: late }, expectationOf('al1')).reasons).toEqual([
      'checkout started firing at 12:47 UTC, expected 12:02 UTC to 12:22 UTC',
    ]);
  });

  test('reads the single series of an alert that keeps to checkout', () => {
    const expr =
      'sum(rate(http_requests_total{service="checkout-svc",code=~"5.."}[1m])) / sum(rate(http_requests_total{service="checkout-svc"}[1m]))';
    const spec = specWith({ query: { ...written.spec?.query, expr } });
    const single = { replayable: true as const, series: [{ ...series('', 9), labels: {} }] };
    const outcome = { ...written, spec, replay: single };
    expect(scoreAlert(outcome, expectationOf('al1'))).toEqual({ pass: true, reasons: [] });
  });

  test('fails an agent at level 2 that replays, or never says it cannot', () => {
    const replaying = { ...unreplayed, toolCalls: { replay_alert: 2 }, said: 'It fired once.' };
    expect(scoreAlert(replaying, expectationOf('al2')).reasons).toEqual([
      'called replay_alert 2 times, expected none',
      'the agent never says it cannot replay the numbers',
    ]);
  });

  test('fails a follow-up that saved no new version', () => {
    expect(scoreAlert({ ...waited, versions: 0 }, expectationOf('al3')).reasons).toEqual([
      'no new version was saved',
    ]);
  });

  test('fails an alert from a panel whose query differs, or with no link from it', () => {
    const { panel: _panel, ...unread } = fromPanel;
    expect(scoreAlert(unread, expectationOf('al4')).reasons).toEqual(['the panel was not read']);
    const other = { ...fromPanel, panel: { panel: 'a', alert: 'b', links: ['agent'] } };
    expect(scoreAlert(other, expectationOf('al4')).reasons).toEqual([
      "the alert's query does not match the panel's",
      'no from_panel link to the panel',
    ]);
  });
});

describe('alert cases in the report', () => {
  test('say the condition in words', () => {
    expect(conditionWords(specWith())).toBe('above 2% for 5m, every 1m on prometheus-dev');
    expect(conditionWords(fromPanel.spec as AlertSpec)).toBe(
      'above 3% at once, every 1m on prometheus-dev',
    );
  });

  test('score by their case, and show the condition, the replay and the tools', () => {
    const results = scoreAll([written]);
    expect(isAlert(written)).toBe(true);
    expect(results[0]?.score.pass).toBe(true);
    const report = {
      startedAt: '2026-10-04T10:00:00.000Z',
      models: { model: 'test-model' },
      cache: { hits: 1, misses: 0 },
      results,
    };
    const html = htmlReport(report);
    expect(html).toContain("Tell me when checkout's 5xx share stays above 2% for 5 minutes.");
    expect(html).toContain('“Checkout 5xx share”: above 2% for 5m');
    expect(html).toContain('service=checkout-svc: fired 1 time (12:11 UTC to 12:31 UTC)');
    expect(html).toContain('1 other series never fired.');
    expect(html).toContain('Tools: describe, propose_alert, edit_alert, replay_alert.');
    expect(html).toContain('1 version · 0 repairs');
    expect(markdownReport(report)).toContain('- service=payments-svc: fired 1 time');
  });
});
