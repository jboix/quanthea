/** A spec over the in-memory `events` connector, for the dashboards tests. */

/**
 * A spec with a stat, a chart marking the events, and a table, plus one variable of each kind.
 * The memory connector understands `SELECT * FROM events` only.
 *
 * @returns A fresh copy.
 */
export function eventsSpec() {
  const events = { connector: 'events', language: 'sql' as const, sql: 'SELECT * FROM events' };
  return {
    specVersion: 1,
    title: 'Events',
    description: 'Errors by service.',
    time: { from: 'now-1h', to: 'now' },
    variables: [
      { kind: 'custom', name: 'env', options: ['prod', 'staging'], default: 'prod' },
      {
        kind: 'query',
        name: 'service',
        source: events,
        multi: true,
        includeAll: true,
        default: '$__all',
      },
      { kind: 'text', name: 'order', default: 'A-1', pattern: '[A-Z]-\\d+' },
    ],
    annotations: [
      {
        id: 'events',
        label: 'event',
        query: { refId: 'M', ...events },
        timeField: 'time',
        textField: 'service',
      },
    ],
    panels: [
      {
        id: 'errors-peak',
        title: 'Errors · peak',
        grid: { x: 0, y: 0, w: 4, h: 3 },
        queries: [{ refId: 'A', ...events }],
        view: {
          kind: 'stat',
          ref: 'A',
          field: 'errors',
          reduce: 'max',
          format: { $fmt: 'number' },
        },
      },
      {
        id: 'errors-over-time',
        title: 'Errors over time',
        grid: { x: 0, y: 3, w: 12, h: 6 },
        queries: [{ refId: 'A', ...events }],
        view: {
          kind: 'chart',
          datasets: [{ ref: 'A' }],
          markers: [{ annotation: 'events' }],
          option: { xAxis: { type: 'time' }, yAxis: { type: 'value' }, series: [{ type: 'line' }] },
        },
      },
    ],
  };
}
