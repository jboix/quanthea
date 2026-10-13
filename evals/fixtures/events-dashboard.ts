/**
 * The player events dashboard some answer cases ask about: one panel, the events per hour of the
 * index `core_events` on the dev OpenSearch, written as the series builder writes it. The run
 * creates and pins it the first time a case asks about it, and it needs `--search`.
 */
import { searchConnector } from '../world/setup.ts';

/** The panel's query: a count per hour, bound to the range by the built-in variables. */
const eventsPerHour = {
  refId: 'A',
  connector: searchConnector,
  language: 'search',
  index: 'core_events',
  body: {
    size: 0,
    query: {
      bool: {
        filter: [{ range: { '@timestamp': { gte: { $var: '__from' }, lte: { $var: '__to' } } } }],
      },
    },
    aggs: {
      time: {
        date_histogram: { field: '@timestamp', fixed_interval: '1h', min_doc_count: 0 },
        aggs: { value: { value_count: { field: '@timestamp' } } },
      },
    },
  },
} as const;

/** The dashboard's spec, as `dashboards.create` takes it. */
export const eventsDashboard = {
  specVersion: 1,
  title: 'Player events',
  description: 'How many events the media players send, hour by hour.',
  time: { from: 'now-24h', to: 'now' },
  variables: [],
  annotations: [],
  panels: [
    {
      id: 'events-per-hour',
      title: 'Events per hour',
      grid: { x: 0, y: 0, w: 12, h: 6 },
      queries: [eventsPerHour],
      view: {
        kind: 'chart',
        datasets: [{ ref: 'A' }],
        option: {
          xAxis: { type: 'time' },
          yAxis: { type: 'value' },
          tooltip: { trigger: 'axis' },
          series: [{ type: 'line', showSymbol: false }],
        },
      },
    },
  ],
} as const;
