import { describe, expect, test } from 'bun:test';
import { salesSpec } from './test/fixtures.ts';
import { validateReportSpec } from './validate.ts';

/**
 * A connector lookup knowing one SQL connector.
 *
 * @param maxRangeDays - The longest range it allows.
 * @returns The lookup.
 */
function lookup(maxRangeDays = 62) {
  const facts = {
    language: 'sql' as const,
    dialect: 'postgres' as const,
    guardrails: { timeoutMs: 1000, maxRows: 1000, maxRangeDays },
  };
  return (name: string) => (name === 'orders' ? facts : undefined);
}

/**
 * The paths of the issues a spec raises.
 *
 * @param spec - The spec.
 * @param context - What validation knows besides the connectors.
 * @param maxRangeDays - The connector's longest range.
 * @returns The paths.
 */
function issuePaths(
  spec: unknown,
  context: {
    channelExists?: (id: string) => boolean;
    dashboardPinned?: (id: string) => boolean;
  } = {},
  maxRangeDays?: number,
): string[] {
  const now = Date.parse('2025-10-06T06:00:00Z');
  const result = validateReportSpec(spec, { lookup: lookup(maxRangeDays), now, ...context });
  return result.ok ? [] : result.issues.map((issue) => issue.path);
}

describe('validating a report spec', () => {
  test('takes a good spec and moves overlapping panels down, as a dashboard does', () => {
    const stacked = (salesSpec().panels as object[]).map((panel) => ({
      ...panel,
      grid: { x: 0, y: 0, w: 3, h: 3 },
    }));
    const result = validateReportSpec(salesSpec({ panels: stacked }), { lookup: lookup(), now: 0 });
    expect(result.ok && result.spec.panels.map((panel) => panel.grid.y)).toEqual([0, 3, 6]);
  });

  test('checks the panels with the dashboard checks, on the same paths', () => {
    const panels = salesSpec().panels as Record<string, unknown>[];
    const unknown = {
      ...panels[0],
      queries: [{ refId: 'A', connector: 'gone', language: 'sql', sql: 'SELECT 1' }],
    };
    expect(issuePaths(salesSpec({ panels: [unknown, ...panels.slice(1)] }))).toEqual([
      'panels[0].queries[0].connector',
    ]);
  });

  test('refuses a time zone it does not know, and a period too long for the connector', () => {
    const schedule = { every: 'day', at: '08:00', timezone: 'Mars/Olympus' };
    expect(issuePaths(salesSpec({ schedule }))).toEqual(['schedule.timezone']);
    expect(issuePaths(salesSpec({ period: 'previous_month' }), {}, 7)).toContain('period');
  });

  test('refuses a channel or a dashboard link that does not exist', () => {
    const spec = salesSpec({ seeAlso: [{ dashboardId: 'sales' }] });
    expect(issuePaths(spec, { channelExists: () => false, dashboardPinned: () => false })).toEqual([
      'delivery.channels[0]',
      'seeAlso[0].dashboardId',
    ]);
    expect(issuePaths(spec, { channelExists: () => true, dashboardPinned: () => true })).toEqual(
      [],
    );
  });
});
