/**
 * Helpers shared by the report tests: a weekly sales spec, a query engine that answers each panel
 * with a number for the period and another for the period before, and the reports service over a
 * fresh database with a clock the test moves.
 */
import type { ReportNotification, ReportSettings, SendResult } from '@quanthea/shared';
import { fakeEngine, frameOf } from '../../alerts/test/fixtures.ts';
import { createAuditRepository } from '../../db/audit-repository.ts';
import type { openDatabase } from '../../db/database.ts';
import { createReportRepository } from '../../db/report-repository.ts';
import { createReportRunRepository } from '../../db/report-run-repository.ts';
import type { QueryRequest } from '../../query/executor.ts';
import { createReports } from '../reports.ts';

/** Monday 6 October 2025 at 08:00 in Zurich: week 41 starts, week 40 is the previous week. */
export const mondayMorning = Date.parse('2025-10-06T06:00:00Z');

/** The start of week 40 in Zurich, the period of a run on {@link mondayMorning}. */
export const week40 = Date.parse('2025-09-28T22:00:00Z');

/** A minute, in milliseconds. */
export const minute = 60_000;

/** The numbers each panel's query answers: over the period, and over the period before. */
export const answers: Readonly<Record<string, readonly [number, number]>> = {
  revenue: [184_320, 173_560],
  orders: [2914, 2826],
  failed: [0.018, 0.022],
};

/**
 * A stat panel over the orders.
 *
 * @param id - The panel id, which its query's column is named after.
 * @param x - Its column.
 * @param format - Its format.
 * @returns The panel, as JSON.
 */
function stat(id: string, x: number, format: Record<string, unknown>) {
  return {
    id,
    title: id === 'failed' ? 'Failed orders' : `${id[0]?.toUpperCase()}${id.slice(1)}`,
    grid: { x, y: 0, w: 3, h: 3 },
    queries: [
      {
        refId: 'A',
        connector: 'orders',
        language: 'sql',
        sql: `SELECT ${id} FROM weekly WHERE day BETWEEN :__from AND :__to`,
      },
    ],
    view: { kind: 'stat', ref: 'A', reduce: 'last', format },
  };
}

/**
 * The weekly sales report, with fields replaced.
 *
 * @param overrides - Fields to replace.
 * @returns The spec, as JSON.
 */
export function salesSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    specVersion: 1,
    title: 'Weekly sales',
    schedule: { every: 'week', weekday: 'monday', at: '08:00', timezone: 'Europe/Zurich' },
    period: 'previous_week',
    panels: [
      stat('revenue', 0, { $fmt: 'currency', code: 'CHF', decimals: 0 }),
      stat('orders', 3, { $fmt: 'number', decimals: 0 }),
      stat('failed', 6, { $fmt: 'percent', decimals: 1 }),
    ],
    summaryPanels: ['revenue', 'orders', 'failed'],
    delivery: { channels: ['sales'] },
    ...overrides,
  };
}

/**
 * Answers a panel's query with its number, for the period or the period before.
 *
 * @param request - The query.
 * @param periodFrom - The start of the period the test expects.
 * @returns One frame with one row.
 */
export function answerFor(request: QueryRequest, periodFrom: number) {
  const sql = 'sql' in request.template ? request.template.sql : '';
  const name = /^SELECT (\w+)/.exec(sql)?.[1] ?? '';
  const [current, before] = answers[name] ?? [0, 0];
  const value = request.timeRange.from.getTime() >= periodFrom ? current : before;
  return [frameOf([{ name, type: 'number' }], [[value]])];
}

/** What the reports fixture can change. */
export interface FixtureOptions {
  /** Answers each query; the weekly numbers for week 40 by default. */
  readonly answer?: (request: QueryRequest) => ReturnType<typeof answerFor> | Error;
  /** Whether a failed run notifies. */
  readonly notifyOnError?: boolean;
  /** The report settings. */
  readonly settings?: Partial<ReportSettings>;
  /** The channels that exist. */
  readonly channels?: readonly string[];
}

/**
 * The reports service over a database, a fake engine and a clock the test moves.
 *
 * @param database - A database the migrations have run on.
 * @param options - The answers, the error setting, the report settings and the channels.
 * @returns The service, the messages sent, the clock and the engine's requests.
 */
export function reportsFixture(
  database: ReturnType<typeof openDatabase>,
  options: FixtureOptions = {},
) {
  const clock = { now: mondayMorning };
  const sent: ReportNotification[] = [];
  const engine = fakeEngine(options.answer ?? ((request) => answerFor(request, week40)));
  const channels = new Set(options.channels ?? ['sales']);
  // Read on each call, so a test can change its settings object.
  const settings = () => ({
    maxRetries: 2,
    retryDelay: '15m',
    keepRunsDays: null,
    ...options.settings,
  });
  const sendReport = (ids: readonly string[], notification: ReportNotification) => {
    sent.push(notification);
    const result = (channelId: string): SendResult => ({
      ...{ channelId, ok: true, httpStatus: 200, attempts: 1, error: null },
    });
    return Promise.resolve(ids.map(result));
  };
  const reports = createReports({
    ...engine,
    repository: createReportRepository(database),
    runs: createReportRunRepository(database),
    audit: createAuditRepository(database),
    lookup: () => ({
      language: 'sql',
      dialect: 'postgres',
      guardrails: { timeoutMs: 1000, maxRows: 1000, maxRangeDays: 62 },
    }),
    dashboard: () => undefined,
    channelExists: (id) => channels.has(id),
    sendReport,
    notifyOnError: () => options.notifyOnError ?? true,
    settings: { get: settings },
    publicUrl: 'https://quanthea.test/',
    now: () => clock.now,
  });
  return { reports, sent, clock, requests: engine.requests, channels };
}
