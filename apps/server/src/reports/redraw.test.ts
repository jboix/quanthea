import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { frameOf } from '../alerts/test/fixtures.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { temporaryDir } from '../test/fixtures.ts';
import { reportsFixture, salesSpec } from './test/fixtures.ts';

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
 * A chart panel of orders over time.
 *
 * @param id - The panel id.
 * @param bucket - The bucket its query groups by, as SQL.
 * @returns The panel, as JSON.
 */
function chart(id: string, bucket: string) {
  const sql = `SELECT ${bucket} AS time, count(*) AS orders FROM orders WHERE created_at BETWEEN :__from AND :__to GROUP BY 1`;
  return {
    id,
    title: id,
    grid: { x: 0, y: 3, w: 6, h: 6 },
    queries: [{ refId: 'A', connector: 'orders', language: 'sql', sql }],
    view: { kind: 'chart', option: { series: [{ type: 'line' }] }, datasets: [{ ref: 'A' }] },
  };
}

/** The weekly sales report with one chart that follows the interval and one that does not. */
const withCharts = () => {
  const { panels } = salesSpec() as { panels: unknown[] };
  const follows = chart('trend', 'date_bin(:__interval::interval, created_at, :__from)');
  return salesSpec({
    panels: [...panels, follows, chart('fixed', "date_trunc('minute', created_at)")],
  });
};

/**
 * Runs the report with charts once by hand.
 *
 * @returns The fixture, the report and its run.
 */
async function ranOnce() {
  const answer = () => [frameOf([{ name: 'orders', type: 'number' }], [[1]])];
  const fixture = reportsFixture(database, { answer });
  const { reportId } = fixture.reports.saveVersion({ spec: withCharts() }, 'ada');
  await fixture.reports.activate(reportId, 1, 'ada');
  const run = await fixture.reports.runNow(reportId, false, 'ada');
  return { fixture, reportId, runId: run.id };
}

describe('a run', () => {
  test('cuts its charts at the interval its period takes: a week by the hour', async () => {
    const { fixture } = await ranOnce();
    const charted = fixture.requests.filter((request) => /AS time/.test(JSON.stringify(request)));
    expect(charted.length).toBeGreaterThan(0);
    expect(new Set(charted.map((request) => request.interval))).toEqual(new Set(['1h']));
  });

  test('gives its stats no interval: a number reduced from a query reads as it was written', async () => {
    const { fixture } = await ranOnce();
    const stats = fixture.requests.filter((request) => !/AS time/.test(JSON.stringify(request)));
    expect(stats.length).toBeGreaterThan(0);
    expect(new Set(stats.map((request) => request.interval))).toEqual(new Set([undefined]));
  });
});

describe('a run drawn again at another interval', () => {
  test('runs only the charts that follow the interval, over the period of the run', async () => {
    const { fixture, reportId, runId } = await ranOnce();
    const stored = fixture.reports.run(reportId, runId, 'viewer');
    fixture.requests.length = 0;
    const redraw = await fixture.reports.redraw(reportId, runId, '6h', 'viewer');
    expect(redraw.interval).toBe('6h');
    expect(Object.keys(redraw.panels)).toEqual(['trend']);
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({ interval: '6h' });
    expect(fixture.requests[0]?.timeRange.from.getTime()).toBe(stored.period.from);
    expect(fixture.requests[0]?.timeRange.to.getTime()).toBe(stored.period.to);
  });

  test('stores nothing: the run keeps its results and its numbers', async () => {
    const { fixture, reportId, runId } = await ranOnce();
    const before = fixture.reports.run(reportId, runId, 'viewer');
    await fixture.reports.redraw(reportId, runId, '1d', 'viewer');
    expect(fixture.reports.run(reportId, runId, 'viewer')).toEqual(before);
  });

  test('refuses an interval that would cut the period too fine', async () => {
    const { fixture, reportId, runId } = await ranOnce();
    await expect(fixture.reports.redraw(reportId, runId, '1m', 'viewer')).rejects.toThrow(
      '1m does not suit the period of this run.',
    );
  });

  test('is not found for a run the reader may not see', async () => {
    const { fixture, reportId } = await ranOnce();
    await expect(fixture.reports.redraw(reportId, 'nope', '1h', 'viewer')).rejects.toThrow(
      'has no run',
    );
  });
});
