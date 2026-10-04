import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { temporaryDir } from '../test/fixtures.ts';
import {
  answerFor,
  minute,
  mondayMorning,
  reportsFixture,
  salesSpec,
  week40,
} from './test/fixtures.ts';

/** The start of week 41 in Zurich. */
const week41 = Date.parse('2025-10-05T22:00:00Z');

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * Saves and activates the weekly sales report.
 *
 * @param fixture - The reports fixture.
 * @param overrides - Fields of the spec to replace.
 * @returns The report's id.
 */
async function activeReport(
  fixture: ReturnType<typeof reportsFixture>,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { reportId } = fixture.reports.saveVersion({ spec: salesSpec(overrides) }, 'ada');
  await fixture.reports.activate(reportId, 1, 'ada');
  fixture.sent.length = 0;
  return reportId;
}

describe('a scheduled run', () => {
  test('freezes every panel over the period and the week before, and sends the numbers', async () => {
    const fixture = reportsFixture(database, { answer: (request) => answerFor(request, week41) });
    const id = await activeReport(fixture);
    fixture.clock.now = mondayMorning + 7 * 86_400_000 + 5000;
    const [scheduled] = fixture.reports.startDue();
    expect(scheduled).toEqual({ runId: expect.any(String), connector: 'orders' });
    await fixture.reports.attempt(scheduled?.runId ?? '');
    const run = fixture.reports.run(id, scheduled?.runId ?? '', 'viewer');
    expect(run).toMatchObject({
      status: 'ok',
      attempts: 1,
      trigger: 'schedule',
      period: { from: week41, label: 'week 41, 6 – 12 Oct' },
      comparison: { label: 'week 40, 29 Sep – 5 Oct' },
      variables: {},
    });
    expect(Object.keys(run.panels ?? {})).toEqual(['revenue', 'orders', 'failed']);
    expect(Object.keys(run.comparisonPanels ?? {})).toEqual(['revenue', 'orders', 'failed']);
    expect(run.headlines.map((each) => [each.title, each.change?.text])).toEqual([
      ['Revenue', '▲ 6.2%'],
      ['Orders', '▲ 3.1%'],
      ['Failed orders', '▼ 0.4 pt'],
    ]);
    expect(run.sentAt).not.toBeNull();
    expect(run.delivery).toEqual([
      { channelId: 'sales', ok: true, httpStatus: 200, attempts: 1, error: null },
    ]);
  });
});

describe('a run made by hand', () => {
  test('covers the latest period, is marked manual, and sends only when asked', async () => {
    const fixture = reportsFixture(database);
    const id = await activeReport(fixture);
    const quiet = await fixture.reports.runNow(id, false, 'ada');
    expect(quiet).toMatchObject({
      trigger: 'manual',
      status: 'ok',
      startedBy: 'ada',
      period: { from: week40, label: 'week 40, 29 Sep – 5 Oct' },
      sentAt: null,
    });
    expect(fixture.sent).toEqual([]);
    await fixture.reports.runNow(id, true, 'ada');
    expect(fixture.sent).toHaveLength(1);
    const [message] = fixture.sent;
    expect(message).toMatchObject({
      event: 'report.ready',
      test: false,
      title: 'Weekly sales · week 40, 29 Sep – 5 Oct',
      run: { comparison: 'week 39, 22 – 28 Sep' },
      lines: [
        { label: 'Revenue', change: '▲ 6.2%' },
        { label: 'Orders', value: '2,914', change: '▲ 3.1%' },
        { label: 'Failed orders', value: '1.8%', change: '▼ 0.4 pt' },
      ],
    });
    expect(message?.link.url).toMatch(/^https:\/\/quanthea\.test\/reports\/.+\/runs\/.+$/);
  });

  test('is never rewritten once finished', async () => {
    const fixture = reportsFixture(database);
    const id = await activeReport(fixture);
    const run = await fixture.reports.runNow(id, false, 'ada');
    const rewrite = () =>
      database.run("UPDATE report_runs SET headlines = '[]' WHERE id = ?", [run.id]);
    expect(rewrite).toThrow('a finished report run is never rewritten');
    expect(fixture.reports.run(id, run.id, 'editor').headlines).toHaveLength(3);
  });

  test('without a comparison runs the period only', async () => {
    const fixture = reportsFixture(database);
    const id = await activeReport(fixture, { compare: 'none' });
    const run = await fixture.reports.runNow(id, false, 'ada');
    expect(run.comparison).toBeNull();
    expect(run.headlines.every((each) => each.change === null)).toBe(true);
    expect(fixture.reports.run(id, run.id, 'editor').comparisonPanels).toBeNull();
  });
});

describe('stepping through runs', () => {
  test('a run links to the runs of the periods before and after it', async () => {
    const fixture = reportsFixture(database);
    const id = await activeReport(fixture);
    const week = 7 * 86_400_000;
    const first = await fixture.reports.runNow(id, false, 'ada');
    fixture.clock.now += week;
    const second = await fixture.reports.runNow(id, false, 'ada');
    fixture.clock.now += week;
    const third = await fixture.reports.runNow(id, false, 'ada');
    const middle = fixture.reports.run(id, second.id, 'viewer');
    expect(middle.previous).toEqual({ id: first.id, period: first.period });
    expect(middle.next).toEqual({ id: third.id, period: third.period });
    expect(fixture.reports.run(id, first.id, 'viewer').previous).toBeNull();
    const page = fixture.reports.runs(id, 'viewer', { before: third.period.from, limit: 1 });
    expect(page.map((run) => run.id)).toEqual([second.id]);
  });
});

describe('a run that fails', () => {
  /**
   * The fixture with an engine that fails every query once activation has run.
   *
   * @param notifyOnError - The global "cannot be checked" setting.
   * @returns The fixture, and a switch that makes the source fail.
   */
  function failingFixture(notifyOnError = true) {
    const source = { down: false };
    const fixture = reportsFixture(database, {
      notifyOnError,
      answer: (request) =>
        source.down ? new Error('The data source did not answer.') : answerFor(request, week40),
    });
    return { fixture, source };
  }

  test('tries again after the delay, up to the retries, then fails and says so', async () => {
    const { fixture, source } = failingFixture();
    const id = await activeReport(fixture);
    source.down = true;
    const run = await fixture.reports.runNow(id, true, 'ada');
    expect(run).toMatchObject({
      status: 'running',
      attempts: 1,
      retryAt: mondayMorning + 15 * minute,
    });
    expect(run.error).toContain('Panel "Revenue": ');
    expect(fixture.reports.pending()).toEqual([]);
    fixture.clock.now += 15 * minute;
    expect(fixture.reports.pending().map((each) => each.runId)).toEqual([run.id]);
    await fixture.reports.attempt(run.id);
    fixture.clock.now += 15 * minute;
    await fixture.reports.attempt(run.id);
    const failed = fixture.reports.run(id, run.id, 'editor');
    expect(failed).toMatchObject({ status: 'failed', attempts: 3, retryAt: null });
    expect(fixture.sent).toMatchObject([
      {
        event: 'report.failed',
        title: 'Weekly sales · week 40, 29 Sep – 5 Oct',
        lines: [],
        reason: expect.stringContaining('The data source did not answer.'),
      },
    ]);
    expect(fixture.reports.pending()).toEqual([]);
  });

  test('records the failure but tells no one when the setting is off', async () => {
    const { fixture, source } = failingFixture(false);
    const id = await activeReport(fixture);
    source.down = true;
    const run = await fixture.reports.runNow(id, true, 'ada');
    for (const _ of [1, 2]) {
      fixture.clock.now += 15 * minute;
      await fixture.reports.attempt(run.id);
    }
    expect(fixture.reports.run(id, run.id, 'editor')).toMatchObject({
      status: 'failed',
      sentAt: null,
    });
    expect(fixture.sent).toEqual([]);
  });

  test('a version whose queries fail cannot be activated', async () => {
    const { fixture, source } = failingFixture();
    const { reportId } = fixture.reports.saveVersion({ spec: salesSpec() }, 'ada');
    source.down = true;
    await expect(fixture.reports.activate(reportId, 1, 'ada')).rejects.toMatchObject({
      code: 'bad_request',
      details: [expect.objectContaining({ path: 'panels' })],
    });
  });
});
