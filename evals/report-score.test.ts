import { describe, expect, test } from 'bun:test';
import { type Headline, type ReportSpec, reportSpecSchema } from '@quanthea/shared';
import { htmlReport, markdownReport } from './render.ts';
import { scheduleWords } from './render-report.ts';
import { scoreAll } from './report.ts';
import { type ReportExpectation, reportCases } from './report-cases.ts';
import { type OrderTruth, type ReportCaseOutcome, scoreReport } from './report-score.ts';

/**
 * A report case's expectation, by id.
 *
 * @param id - The case's id.
 * @returns Its expectation.
 */
function expectationOf(id: string): ReportExpectation {
  const found = reportCases.find((each) => each.id === id);
  if (found?.mode !== 'write') throw new Error(`No report case ${id}.`);
  return found.expect;
}

/**
 * A stat panel on the dev Postgres.
 *
 * @param id - Its id.
 * @param title - Its title.
 * @param sql - Its query.
 * @param connector - Its connector.
 * @returns The panel.
 */
function statPanel(id: string, title: string, sql: string, connector = 'postgres-orders') {
  return {
    id,
    title,
    grid: { x: 0, y: 0, w: 3, h: 3 },
    queries: [{ refId: 'A', connector, language: 'sql', sql }],
    view: { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number', decimals: 0 } },
  };
}

const between = 'created_at BETWEEN :__from AND :__to';

/**
 * A spec as the agent would save it for r1, with some fields replaced.
 *
 * @param overrides - Fields to replace.
 * @returns The parsed spec.
 */
function specWith(overrides: Record<string, unknown> = {}): ReportSpec {
  return reportSpecSchema.parse({
    specVersion: 1,
    title: 'Daily orders',
    variables: [],
    panels: [
      statPanel('orders', 'Orders', `SELECT count(*) FROM orders WHERE ${between}`),
      statPanel(
        'revenue',
        'Revenue',
        `SELECT sum(total_cents) / 100.0 FROM orders WHERE ${between}`,
      ),
      statPanel('failed', 'Failed orders', `SELECT count(*) FROM orders WHERE status = 'failed'`),
    ],
    schedule: { every: 'day', at: '07:00', timezone: 'Europe/Zurich' },
    period: 'previous_day',
    compare: 'previous_period',
    summaryPanels: ['orders', 'revenue', 'failed'],
    delivery: { channels: ['channel-1'] },
    ...overrides,
  });
}

const truth: OrderTruth = {
  paid: 63_016,
  all: 64_680,
  failed: 1_012,
  paidCents: 661_681_396,
  allCents: 678_603_607,
};

/**
 * A headline number.
 *
 * @param title - Its panel's title.
 * @param value - Its number.
 * @returns The headline.
 */
function headline(title: string, value: number | null): Headline {
  const text = String(value);
  return { panelId: title, title, value, text, previous: null, previousText: null, change: null };
}

const goodHeadlines = [
  headline('Orders', 64_680),
  headline('Revenue', 6_616_813.96),
  headline('Failed orders', 1_012),
];

const written: ReportCaseOutcome = {
  kind: 'report',
  id: 'r1',
  spec: specWith(),
  versions: 1,
  channelIds: ['channel-1'],
  previewFailure: null,
  run: {
    status: 'ok',
    error: null,
    period: { from: 0, to: 1, label: 'Sat 3 Oct' },
    headlines: goodHeadlines,
  },
  truth,
  toolCalls: { propose_report: 1, edit_report: 1 },
  said: 'Saved the daily report.',
  asked: [],
  repairs: 0,
  turns: 2,
  usage: {},
  durationMs: 1000,
};

/**
 * The outcome of r1 with some fields replaced.
 *
 * @param overrides - Fields to replace.
 * @returns The outcome.
 */
function outcomeWith(overrides: Partial<ReportCaseOutcome>): ReportCaseOutcome {
  return { ...written, ...overrides };
}

/**
 * The outcome of r1 with other headlines in its run.
 *
 * @param headlines - The headlines.
 * @returns The outcome.
 */
function withHeadlines(headlines: Headline[]): ReportCaseOutcome {
  const run = written.run;
  if (!run) throw new Error('No run.');
  return outcomeWith({ run: { ...run, headlines } });
}

/**
 * The reasons an outcome fails r1.
 *
 * @param outcome - The outcome.
 * @returns The reasons.
 */
function reasonsFor(outcome: ReportCaseOutcome): readonly string[] {
  return scoreReport(outcome, expectationOf('r1')).reasons;
}

describe('scoreReport', () => {
  test('passes a daily report whose run counts what the database holds', () => {
    expect(scoreReport(written, expectationOf('r1'))).toEqual({ pass: true, reasons: [] });
  });

  test('fails a run that failed, and a thread that saved nothing', () => {
    expect(reasonsFor(outcomeWith({ error: 'quota spent' }))).toEqual([
      'the run failed: quota spent',
    ]);
    const { spec: _spec, ...unsaved } = written;
    expect(reasonsFor({ ...unsaved, versions: 0 })).toEqual(['no report version was saved']);
  });

  test('fails each part of the schedule, the period and the comparison', () => {
    const weekly = { every: 'week', weekday: 'friday', at: '08:00', timezone: 'UTC' };
    const spec = specWith({ schedule: weekly, period: 'previous_week', compare: 'none' });
    expect(reasonsFor(outcomeWith({ spec }))).toEqual([
      'it runs every week, expected every day',
      'it runs at 08:00, expected 07:00',
      'its clock is UTC, expected Europe/Zurich',
      'it covers previous_week, expected previous_day',
      'it compares with none, expected previous_period',
    ]);
  });

  test('fails a weekly report on another weekday', () => {
    const schedule = { every: 'week', weekday: 'friday', at: '07:00', timezone: 'Europe/Zurich' };
    const spec = specWith({ schedule, period: 'previous_week' });
    const reasons = scoreReport(outcomeWith({ spec }), expectationOf('r2')).reasons;
    expect(reasons).toEqual(['it runs on friday, expected monday']);
  });

  test('fails headline panels that miss a topic, another connector and an unknown channel', () => {
    const spec = specWith({
      panels: [
        statPanel('orders', 'Orders', 'SELECT count(*) FROM orders'),
        statPanel('up', 'Up', 'up', 'prometheus-dev'),
      ],
      summaryPanels: ['orders'],
      delivery: { channels: ['channel-2'] },
    });
    expect(reasonsFor(outcomeWith({ spec }))).toEqual([
      'no headline panel shows revenue or sales or total_cents or amount',
      'panels query another connector than postgres-orders: Up',
      'the report names unknown channels: channel-2',
    ]);
  });

  test('fails a preview that failed or did not run, and a follow-up that saved nothing', () => {
    expect(reasonsFor(outcomeWith({ previewFailure: 'Revenue: syntax error' }))).toEqual([
      'the preview failed: Revenue: syntax error',
    ]);
    const { previewFailure: _previewFailure, ...unpreviewed } = written;
    expect(reasonsFor(unpreviewed)).toEqual(['the preview failed: it did not run']);
    const followUp = scoreReport(outcomeWith({ versions: 0 }), expectationOf('r2')).reasons;
    expect(followUp).toContain('no new version was saved');
  });

  test('fails a run that was not made, that failed, or whose orders were not counted', () => {
    const { run, truth: _truth, ...unrun } = written;
    expect(reasonsFor(unrun)).toEqual(['the saved version was not run']);
    if (!run) throw new Error('No run.');
    const failed = { ...run, status: 'failed', error: 'Orders: timeout' };
    expect(reasonsFor(outcomeWith({ run: failed }))).toEqual(['the run failed: Orders: timeout']);
    expect(reasonsFor({ ...unrun, run })).toEqual(['the orders of the period were not counted']);
  });

  test('takes the orders between the paid ones and every attempt, and revenue in cents too', () => {
    const paidOnly = [headline('Paid orders', 63_016), headline('Revenue', 661_681_396)];
    expect(reasonsFor(withHeadlines(paidOnly))).toEqual([]);
    const share = [...paidOnly, headline('Failed share', 1.565)];
    expect(reasonsFor(withHeadlines(share))).toEqual([]);
  });

  test('fails headlines that are missing or that the database does not hold', () => {
    expect(reasonsFor(withHeadlines([headline('Orders', 64_680)]))).toEqual([
      'no headline number for the revenue',
    ]);
    const wrong = [
      headline('Orders', 70_000),
      headline('Revenue', 5_000_000),
      headline('Failed orders', null),
    ];
    expect(reasonsFor(withHeadlines(wrong))).toEqual([
      'the headline “Orders” is 70000, the database holds 63016 to 64680 orders',
      'the headline “Revenue” is 5000000, the database holds 661681396 to 678603607 cents',
      'the headline “Failed orders” is null, the database holds 1012 failed of 64680',
    ]);
  });
});

describe('scheduleWords', () => {
  test('says when a schedule runs', () => {
    const zone = 'Europe/Zurich';
    expect(scheduleWords({ every: 'day', at: '07:00', timezone: zone })).toBe(
      'every day at 07:00 (Europe/Zurich)',
    );
    expect(scheduleWords({ every: 'week', weekday: 'monday', at: '07:00', timezone: zone })).toBe(
      'every Monday at 07:00 (Europe/Zurich)',
    );
    expect(scheduleWords({ every: 'month', day: 1, at: '07:00', timezone: zone })).toBe(
      'on day 1 of every month at 07:00 (Europe/Zurich)',
    );
  });
});

describe('the report of a report case', () => {
  test('scores it again and shows the schedule, the period and the numbers', () => {
    const [result] = scoreAll([written]);
    expect(result?.score.pass).toBe(true);
    const report = {
      startedAt: '2026-10-04T10:00:00.000Z',
      models: { model: 'gemini-3.5-flash-lite' },
      cache: { hits: 0, misses: 0 },
      results: scoreAll([written]),
    };
    const markdown = markdownReport(report);
    expect(markdown).toContain('runs every day at 07:00 (Europe/Zurich), covers the day before');
    expect(markdown).toContain('Orders: 64680 (64680); the database: 63016 paid, 64680 in all');
    expect(htmlReport(report)).toContain('Run over Sat 3 Oct: ok.');
  });
});
