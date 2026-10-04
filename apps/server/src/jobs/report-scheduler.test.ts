import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import {
  answerFor,
  minute,
  mondayMorning,
  reportsFixture,
  salesSpec,
} from '../reports/test/fixtures.ts';
import { captureLogs, temporaryDir } from '../test/fixtures.ts';
import { purgeReportRuns } from './purge.ts';
import { createReportScheduler } from './report-scheduler.ts';

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

/** A day, in milliseconds. */
const day = 86_400_000;

/**
 * The weekly sales report, active from Monday 6 October 2025, with a scheduler over it.
 *
 * @param options - The fixture's options.
 * @returns The fixture, the report's id and the scheduler.
 */
async function scheduled(options: Parameters<typeof reportsFixture>[1] = {}) {
  const fixture = reportsFixture(database, options);
  const { reportId } = fixture.reports.saveVersion({ spec: salesSpec() }, 'ada');
  await fixture.reports.activate(reportId, 1, 'ada');
  fixture.sent.length = 0;
  const scheduler = createReportScheduler({
    reports: fixture.reports,
    logger: captureLogs().logger,
  });
  return { fixture, reportId, scheduler };
}

describe('the report scheduler', () => {
  test('runs nothing before the next run, then the run due, once', async () => {
    const { fixture, reportId, scheduler } = await scheduled();
    expect(fixture.reports.get(reportId, 'viewer').nextRunAt).toBe(mondayMorning + 7 * day);
    fixture.clock.now = mondayMorning + 7 * day - minute;
    await scheduler.tick();
    expect(fixture.reports.runs(reportId, 'viewer', { limit: 10 })).toEqual([]);
    fixture.clock.now = mondayMorning + 7 * day + minute;
    await scheduler.tick();
    await scheduler.tick();
    const runs = fixture.reports.runs(reportId, 'viewer', { limit: 10 });
    expect(runs.map((run) => [run.trigger, run.status, run.period.label])).toEqual([
      ['schedule', 'ok', 'week 41, 6 – 12 Oct'],
    ]);
    expect(fixture.sent.map((message) => message.event)).toEqual(['report.ready']);
    expect(fixture.reports.get(reportId, 'viewer').nextRunAt).toBe(mondayMorning + 14 * day);
  });

  test('after downtime, runs the latest missed period once, never a backlog', async () => {
    const { fixture, reportId, scheduler } = await scheduled();
    // Down for three weeks and a day: the runs of 13, 20 and 27 October were missed.
    fixture.clock.now = mondayMorning + 22 * day;
    await scheduler.tick();
    const runs = fixture.reports.runs(reportId, 'viewer', { limit: 10 });
    expect(runs.map((run) => run.period.label)).toEqual(['week 43, 20 – 26 Oct']);
    const next = fixture.reports.get(reportId, 'viewer').nextRunAt;
    // Winter time from 26 October: Monday 3 November at 08:00 is 07:00 UTC.
    expect(next).toBe(Date.parse('2025-11-03T07:00:00Z'));
  });

  test('tries a failed run again once its delay is up, and stops at the retries', async () => {
    const source = { down: false };
    const { fixture, reportId, scheduler } = await scheduled({
      answer: (request) =>
        source.down ? new Error('Connection refused.') : answerFor(request, mondayMorning),
    });
    source.down = true;
    fixture.clock.now = mondayMorning + 7 * day;
    await scheduler.tick();
    const [run] = fixture.reports.runs(reportId, 'editor', { limit: 1 });
    expect(run).toMatchObject({ status: 'running', attempts: 1 });
    await scheduler.tick();
    expect(fixture.reports.runs(reportId, 'editor', { limit: 1 })[0]?.attempts).toBe(1);
    for (const _ of [1, 2]) {
      fixture.clock.now += 15 * minute;
      await scheduler.tick();
    }
    expect(fixture.reports.runs(reportId, 'editor', { limit: 1 })[0]).toMatchObject({
      status: 'failed',
      attempts: 3,
    });
    expect(fixture.sent.map((message) => message.event)).toEqual(['report.failed']);
  });

  test('a deactivated report runs no more', async () => {
    const { fixture, reportId, scheduler } = await scheduled();
    fixture.reports.deactivate(reportId, 'ada');
    expect(fixture.reports.get(reportId, 'editor')).toMatchObject({
      deactivated: true,
      nextRunAt: null,
    });
    fixture.clock.now = mondayMorning + 7 * day;
    await scheduler.tick();
    expect(fixture.reports.runs(reportId, 'editor', { limit: 10 })).toEqual([]);
  });
});

describe('the retention of runs', () => {
  test('keeps runs for good by default, else deletes those older than the days kept', async () => {
    const settings = { keepRunsDays: null as number | null };
    const fixture = reportsFixture(database, { settings });
    const { reportId } = fixture.reports.saveVersion({ spec: salesSpec() }, 'ada');
    await fixture.reports.activate(reportId, 1, 'ada');
    const old = await fixture.reports.runNow(reportId, false, 'ada');
    fixture.clock.now += 40 * day;
    const recent = await fixture.reports.runNow(reportId, false, 'ada');
    const logger = captureLogs().logger;
    const purge = () => purgeReportRuns({ reports: fixture.reports, logger, ...noBins });
    expect(purge()).toBe(0);
    settings.keepRunsDays = 30;
    expect(purge()).toBe(1);
    const left = fixture.reports.runs(reportId, 'editor', { limit: 10 }).map((run) => run.id);
    expect(left).toEqual([recent.id]);
    expect(left).not.toContain(old.id);
    expect(fixture.reports.get(reportId, 'editor').versions).toHaveLength(1);
  });
});

/** The bins and retention the purge job needs, empty. */
const noBins = { bin: { purgeAll: () => 0 }, retention: { get: () => ({ binDays: null }) } };
