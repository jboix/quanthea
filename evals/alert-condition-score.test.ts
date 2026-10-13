import { describe, expect, test } from 'bun:test';
import { type AlertSpec, alertSpecSchema } from '@quanthea/shared';
import { type AlertExpectation, alertCases } from './alert-cases.ts';
import { type AlertCaseOutcome, conditionWords, scoreAlert } from './alert-score.ts';

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

/** The requests of each service per second, on the dev Prometheus. */
const requestRate = {
  refId: 'A',
  connector: 'prometheus-dev',
  language: 'promql',
  expr: 'sum by (service) (rate(http_requests_total{env="prod"}[1m]))',
};

/** The order attempts and the share of them that failed, by 10 minutes, on the dev Postgres. */
const failedShare = {
  refId: 'A',
  connector: 'postgres-orders',
  language: 'sql',
  sql: "SELECT date_bin('10 minutes', created_at, :__from) AS time, avg((status = 'failed')::int) AS failed_share, count(*) AS attempts FROM orders WHERE created_at BETWEEN :__from AND :__to GROUP BY 1 ORDER BY 1",
};

/**
 * A spec as the agent would save it, with some fields replaced.
 *
 * @param overrides - Fields to replace.
 * @returns The parsed spec.
 */
function specWith(overrides: Record<string, unknown>): AlertSpec {
  return alertSpecSchema.parse({
    specVersion: 1,
    title: 'An alert',
    query: requestRate,
    every: '5m',
    lookback: '1h',
    severity: 'warning',
    channels: ['channel-1'],
    message: { title: '{alert}: {series} at {value}', body: '{threshold} since {since}.' },
    ...overrides,
  });
}

/**
 * The outcome of a case that saved a spec.
 *
 * @param id - The case's id.
 * @param spec - The spec it saved.
 * @returns The outcome.
 */
function saved(id: string, spec: AlertSpec): AlertCaseOutcome {
  return {
    kind: 'alert',
    id,
    spec,
    versions: 1,
    channelIds: ['channel-1'],
    incidentAt: 0,
    toolCalls: { propose_alert: 1, edit_alert: 1 },
    said: 'Saved.',
    asked: [],
    repairs: 0,
    turns: 2,
    usage: {},
    durationMs: 9000,
  };
}

/**
 * Why a spec fails a case.
 *
 * @param id - The case's id.
 * @param spec - The spec saved.
 * @returns The reasons; none for a good alert.
 */
function reasons(id: string, spec: AlertSpec): readonly string[] {
  return scoreAlert(saved(id, spec), expectationOf(id)).reasons;
}

const halved = {
  kind: 'change',
  direction: 'down',
  amount: 50,
  unit: 'percent',
  within: '10m',
  for: '0m',
};
const belowLastWeek = {
  kind: 'past',
  direction: 'down',
  amount: 30,
  unit: 'percent',
  ago: '7d',
  for: '0m',
};
const unusual = { kind: 'band', side: 'either', deviations: 3, baseline: '6h', for: '5m' };
const manyFailed = {
  kind: 'all',
  of: [
    { kind: 'threshold', op: 'above', value: 0.2 },
    { kind: 'threshold', op: 'above', value: 30, field: 'attempts' },
  ],
  for: '0m',
};
const share = { kind: 'threshold', op: 'above', value: 0.001, for: '0m' };

const good: Readonly<Record<string, AlertSpec>> = {
  al5: specWith({ condition: halved, lookback: '20m' }),
  al6: specWith({
    query: failedShare,
    value: { field: 'attempts', reduce: 'sum' },
    condition: belowLastWeek,
  }),
  al7: specWith({ condition: unusual }),
  al8: specWith({ query: failedShare, value: { field: 'failed_share' }, condition: manyFailed }),
  al9: specWith({
    query: failedShare,
    value: { field: 'attempts', reduce: 'sum' },
    dividedBy: { query: { ...requestRate, refId: 'B' } },
    condition: share,
  }),
};

describe('scoring the kind of condition an alert case asks for', () => {
  test('has a case for a change, the past, a band, joined tests and a ratio', () => {
    const kinds = alertCases.flatMap((each) => each.expect.condition?.kind ?? []);
    expect(kinds).toEqual(['change', 'past', 'band', 'all', 'threshold']);
    expect(alertCases.filter((each) => each.expect.dividedBy !== undefined)).toHaveLength(1);
  });

  test('passes a good alert of each case', () => {
    for (const [id, spec] of Object.entries(good)) expect(reasons(id, spec)).toEqual([]);
  });

  test('takes a duration by its length and joined tests in any order', () => {
    const minutes = specWith({ condition: { ...halved, within: '600s' }, lookback: '20m' });
    expect(reasons('al5', minutes)).toEqual([]);
    const [shareFirst, attempts] = manyFailed.of;
    const turned = {
      ...manyFailed,
      of: [{ kind: 'threshold', op: 'above', value: 30 }, shareFirst],
    };
    expect(attempts?.value).toBe(30);
    expect(reasons('al8', specWith({ query: failedShare, condition: turned }))).toEqual([]);
  });

  test('takes a share as a ratio or in percent', () => {
    const [, attempts] = manyFailed.of;
    const percent = {
      ...manyFailed,
      of: [{ kind: 'threshold', op: 'above', value: 20 }, attempts],
    };
    expect(reasons('al8', specWith({ query: failedShare, condition: percent }))).toEqual([]);
  });

  test('fails another kind, and says which', () => {
    const threshold = specWith({
      condition: { kind: 'threshold', op: 'below', value: 5, for: '0m' },
    });
    expect(reasons('al5', threshold)).toEqual(['the condition is threshold, expected change']);
    expect(reasons('al7', specWith({ condition: belowLastWeek }))).toEqual([
      'the condition is past, expected band',
    ]);
  });

  test('fails a value that is not the one asked, field by field', () => {
    const quarter = { ...halved, direction: 'up', amount: 25, within: '5m' };
    expect(reasons('al5', specWith({ condition: quarter, lookback: '20m' }))).toEqual([
      'direction is up, expected down',
      'amount is 25, expected 50',
      'within is 5m, expected 10m',
    ]);
    const yesterday = specWith({ query: failedShare, condition: { ...belowLastWeek, ago: '1d' } });
    expect(reasons('al6', yesterday)).toEqual(['ago is 1d, expected 7d']);
    const wide = specWith({ condition: { ...unusual, deviations: 2, baseline: '1d' } });
    expect(reasons('al7', wide)).toEqual([
      'deviations is 2, expected 3',
      'baseline is 1d, expected 6h',
    ]);
  });

  test('fails joined tests that miss one asked for, or join them otherwise', () => {
    const [shareFirst] = manyFailed.of;
    const few = { ...manyFailed, of: [shareFirst, { kind: 'threshold', op: 'above', value: 5 }] };
    expect(reasons('al8', specWith({ query: failedShare, condition: few }))).toEqual([
      'no test of the condition is {"kind":"threshold","op":"above","value":30}',
    ]);
    const either = specWith({ query: failedShare, condition: { ...manyFailed, kind: 'any' } });
    expect(reasons('al8', either)).toEqual(['the condition is any, expected all']);
  });

  test('fails a ratio without a second query, or with one on another connector', () => {
    const alone = specWith({ query: failedShare, condition: share });
    expect(reasons('al9', alone)).toEqual(['the alert has no second query to divide by']);
    const same = specWith({
      query: failedShare,
      dividedBy: { query: { ...failedShare, refId: 'B' } },
      condition: { ...share, value: 0.5 },
    });
    expect(reasons('al9', same)).toEqual([
      'value is 0.5, expected 0.001 or 0.1',
      'the second query runs on postgres-orders, expected prometheus-dev',
    ]);
  });

  test('says each kind in words in the report', () => {
    expect(conditionWords(good.al5 as AlertSpec)).toBe(
      'down 50% or more within 10m at once, every 5m on prometheus-dev',
    );
    expect(conditionWords(good.al8 as AlertSpec)).toBe(
      'above 0.2 and attempts above 30 at once, every 5m on postgres-orders',
    );
  });
});
