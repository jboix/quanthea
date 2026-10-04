import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema } from './dashboard.ts';
import { dashboardOfReport, reportSpecSchema } from './report.ts';

/**
 * A stat panel over the orders.
 *
 * @param id - The panel id.
 * @param y - Its row.
 * @returns The panel, as JSON.
 */
function stat(id: string, y: number) {
  return {
    id,
    title: id,
    grid: { x: 0, y, w: 3, h: 3 },
    queries: [{ refId: 'A', connector: 'orders', language: 'sql', sql: 'SELECT 1 AS value' }],
    view: { kind: 'stat', ref: 'A', reduce: 'last', format: { $fmt: 'number' } },
  };
}

/**
 * A weekly sales report, with fields replaced.
 *
 * @param overrides - Fields to replace.
 * @returns The spec, as JSON.
 */
function weekly(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const table = {
    ...stat('top-products', 6),
    view: { kind: 'table', ref: 'A', columns: [{ field: 'value' }] },
  };
  return {
    specVersion: 1,
    title: 'Weekly sales',
    schedule: { every: 'week', weekday: 'monday', at: '08:00', timezone: 'Europe/Zurich' },
    period: 'previous_week',
    panels: [stat('revenue', 0), stat('orders', 3), table],
    summaryPanels: ['revenue', 'orders'],
    ...overrides,
  };
}

/**
 * The paths of the issues a spec raises.
 *
 * @param input - The spec.
 * @returns The paths, dotted.
 */
function issuePaths(input: unknown): string[] {
  const parsed = reportSpecSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
}

describe('the report spec', () => {
  test('parses a good spec and fills the defaults', () => {
    const parsed = reportSpecSchema.parse(weekly());
    expect(parsed.compare).toBe('previous_period');
    expect(parsed.seeAlso).toEqual([]);
    expect(parsed.delivery).toEqual({ channels: [] });
    expect(parsed.variables).toEqual([]);
    expect(parsed.annotations).toEqual([]);
  });

  test('takes each schedule kind and refuses a time or a day that is not one', () => {
    const daily = { every: 'day', at: '07:00', timezone: 'UTC' };
    const monthly = { every: 'month', day: 31, at: '08:00', timezone: 'UTC' };
    expect(issuePaths(weekly({ schedule: daily }))).toEqual([]);
    expect(issuePaths(weekly({ schedule: monthly }))).toEqual([]);
    expect(issuePaths(weekly({ schedule: { ...daily, at: '8:00' } }))).toEqual(['schedule.at']);
    expect(issuePaths(weekly({ schedule: { ...monthly, day: 32 } }))).toEqual(['schedule.day']);
  });

  test('refuses a period it does not know and the fields a dashboard has but a report does not', () => {
    expect(issuePaths(weekly({ period: 'last_7_days' }))).toEqual(['period']);
    expect(issuePaths(weekly({ time: { from: 'now-7d', to: 'now' } }))).toEqual(['']);
  });

  test('takes only stat panels of its own as headlines, each once', () => {
    expect(issuePaths(weekly({ summaryPanels: ['top-products'] }))).toEqual(['summaryPanels.0']);
    expect(issuePaths(weekly({ summaryPanels: ['refunds'] }))).toEqual(['summaryPanels.0']);
    expect(issuePaths(weekly({ summaryPanels: ['orders', 'orders'] }))).toEqual([
      'summaryPanels.1',
    ]);
  });

  test('links each dashboard once', () => {
    const seeAlso = [{ dashboardId: 'sales' }, { dashboardId: 'sales', label: 'Again' }];
    expect(issuePaths(weekly({ seeAlso }))).toEqual(['seeAlso.1.dashboardId']);
  });

  test('runs as a dashboard over its period, on the schedule clock', () => {
    const spec = reportSpecSchema.parse(weekly());
    const dashboard = dashboardOfReport(spec, { from: 0, to: 86_400_000 - 1 });
    expect(dashboardSpecSchema.parse(dashboard)).toEqual(dashboard);
    expect(dashboard.time).toEqual({
      from: '1970-01-01T00:00:00.000Z',
      to: '1970-01-01T23:59:59.999Z',
    });
    expect(dashboard.timezone).toBe('Europe/Zurich');
    expect(dashboard.panels).toEqual(spec.panels);
  });
});
