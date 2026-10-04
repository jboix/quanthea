/** A report spec over the in-memory `events` connector, for the tests of report threads. */
import { eventsSpec } from '../../dashboards/test/events-spec.ts';

/**
 * A weekly report of the events dashboard's stat and chart, with the stat as its headline. The
 * memory connector understands `SELECT * FROM events` only.
 *
 * @param overrides - Fields to replace.
 * @returns A fresh copy, as JSON.
 */
export function eventsReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { panels, annotations } = eventsSpec();
  return {
    specVersion: 1,
    title: 'Weekly errors',
    variables: [],
    annotations,
    panels,
    schedule: { every: 'week', weekday: 'monday', at: '08:00', timezone: 'Europe/Zurich' },
    period: 'previous_week',
    summaryPanels: ['errors-peak'],
    ...overrides,
  };
}
