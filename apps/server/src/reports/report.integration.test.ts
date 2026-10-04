import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { connectorInputSchema, nextRunAt, type ReportSchedule } from '@quanthea/shared';
import type { ConnectorInstance } from '../connectors/_shared/index.ts';
import { devPostgres, integrationEnabled } from '../connectors/_shared/test/dev-sources.ts';
import { postgresConnector } from '../connectors/postgres/postgres-connector.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';

/** Mondays at 08:00 in Zurich. */
const mondays: ReportSchedule = {
  every: 'week',
  weekday: 'monday',
  at: '08:00',
  timezone: 'Europe/Zurich',
};

/**
 * A stat panel of the weekly orders report.
 *
 * @param id - The panel id.
 * @param x - Its column.
 * @param sql - Its query, over the period.
 * @param format - Its format.
 * @returns The panel.
 */
function stat(id: string, x: number, sql: string, format: Record<string, unknown>) {
  return {
    id,
    title: id,
    grid: { x, y: 0, w: 3, h: 3 },
    queries: [{ refId: 'A', connector: 'orders', language: 'sql', sql }],
    view: { kind: 'stat', ref: 'A', reduce: 'last', format },
  };
}

/** The paid orders of a period, in SQL the report's panels and the test's checks both run. */
const paid = "FROM orders WHERE status = 'paid' AND created_at BETWEEN";

/** The weekly orders report over the dev data. */
const weeklyOrders = {
  specVersion: 1,
  title: 'Weekly orders',
  schedule: mondays,
  period: 'previous_week',
  panels: [
    stat('orders', 0, `SELECT count(*) AS orders ${paid} :__from AND :__to`, { $fmt: 'number' }),
    stat(
      'revenue',
      3,
      `SELECT coalesce(sum(total_cents), 0) / 100.0 AS revenue ${paid} :__from AND :__to`,
      { $fmt: 'currency', code: 'CHF', decimals: 0 },
    ),
  ],
  summaryPanels: ['orders', 'revenue'],
};

describe.skipIf(!integrationEnabled)('a weekly orders report on the dev Postgres', () => {
  let dataDir: ReturnType<typeof temporaryDir>;
  const clock = { now: Date.now() };
  let reader: ConnectorInstance;
  let fixture: Awaited<ReturnType<typeof testServices>>;

  /**
   * Counts the paid orders of a window and their revenue, straight from the database.
   *
   * @param from - The first instant.
   * @param to - The last instant.
   * @returns The count and the revenue.
   */
  async function truth(from: number, to: number): Promise<[number, number]> {
    const text = `SELECT count(*)::float8 AS orders, coalesce(sum(total_cents), 0) / 100.0 AS revenue ${paid} $1 AND $2`;
    const timeRange = { from: new Date(from), to: new Date(to) };
    const context = { refId: 'A', signal: AbortSignal.timeout(10_000), timeoutMs: 10_000 };
    const query = { language: 'sql' as const, text, parameters: [timeRange.from, timeRange.to] };
    const [frame] = await reader.execute(query, { ...context, maxRows: 10, timeRange });
    return [Number(frame?.values[0]?.[0]), Number(frame?.values[1]?.[0])];
  }

  /**
   * The Monday 08:00 that ends the week of the latest seeded order.
   *
   * @returns The instant a scheduled run covering that week happens.
   */
  async function mondayAfterTheData(): Promise<number> {
    const query = {
      language: 'sql' as const,
      text: 'SELECT max(created_at) FROM orders',
      parameters: [],
    };
    const timeRange = { from: new Date(0), to: new Date() };
    const context = { refId: 'A', signal: AbortSignal.timeout(10_000), timeoutMs: 10_000 };
    const [frame] = await reader.execute(query, { ...context, maxRows: 1, timeRange });
    return nextRunAt(mondays, Number(frame?.values[0]?.[0]));
  }

  beforeAll(async () => {
    reader = postgresConnector.open({
      config: postgresConnector.configSchema.parse(devPostgres.config),
      secret: postgresConnector.secretSchema.parse(devPostgres.secret),
    });
    clock.now = await mondayAfterTheData();
    dataDir = temporaryDir();
    fixture = await testServices(dataDir.path, [postgresConnector], () => clock.now);
    const input = { name: 'orders', kind: 'postgres', ...devPostgres };
    await fixture.connections.create(connectorInputSchema.parse(input), 'admin-1');
  });

  afterAll(async () => {
    await reader.close();
    await fixture.close();
    dataDir.remove();
  });

  test('runs on schedule over the seeded week, frozen and compared with the week before', async () => {
    const { reports } = fixture;
    clock.now -= 7 * 86_400_000;
    const { reportId } = reports.saveVersion({ spec: weeklyOrders }, 'editor-1');
    await reports.activate(reportId, 1, 'editor-1');
    clock.now += 7 * 86_400_000;
    const [scheduled] = reports.startDue();
    await reports.attempt(scheduled?.runId ?? '');
    const run = reports.run(reportId, scheduled?.runId ?? '', 'viewer');
    expect(run).toMatchObject({ status: 'ok', trigger: 'schedule', attempts: 1 });
    expect(run.period.label).toStartWith('week ');
    const [orders, revenue] = await truth(run.period.from, run.period.to);
    expect(orders).toBeGreaterThan(0);
    const before = run.comparison ?? { from: 0, to: 0 };
    const [ordersBefore] = await truth(before.from, before.to);
    const [ordersHeadline, revenueHeadline] = run.headlines;
    expect(ordersHeadline).toMatchObject({ value: orders, previous: ordersBefore });
    expect(revenueHeadline?.value).toBeCloseTo(revenue, 2);
    expect(run.panels?.orders?.queries[0]?.error).toBeNull();
    expect(reports.list('viewer', 'someone')[0]?.nextRunAt).toBe(nextRunAt(mondays, clock.now));
  });
});
