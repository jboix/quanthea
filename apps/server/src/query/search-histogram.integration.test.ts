import { afterAll, describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/shared';
import type { AnyConnectorKind } from '../connectors/_shared/index.ts';
import {
  devElasticsearch,
  devIncidentStart,
  devOpensearch,
  integrationFor,
} from '../connectors/_shared/test/dev-sources.ts';
import { elasticsearchConnector } from '../connectors/search/elasticsearch-connector.ts';
import { opensearchConnector } from '../connectors/search/opensearch-connector.ts';
import { bindSearch } from './search-binder.ts';

const live = integrationFor('search');
const hour = 3_600_000;
const to = new Date(devIncidentStart().getTime() + hour);
/** Seven days, of which the dev events cover the last hours only. */
const week = { from: new Date(to.getTime() - 7 * 24 * hour), to };
const inPeriod = { range: { '@timestamp': { gte: { $var: '__from' }, lte: { $var: '__to' } } } };

/** Each search kind and its dev server. */
const servers: {
  name: string;
  kind: AnyConnectorKind;
  source: { config: unknown; secret: unknown };
}[] = [
  { name: 'Elasticsearch', kind: elasticsearchConnector, source: devElasticsearch },
  { name: 'OpenSearch', kind: opensearchConnector, source: devOpensearch },
];

/**
 * The values of a frame's column.
 *
 * @param frame - The frame.
 * @param name - The column.
 * @returns Its values, in order.
 */
function column(frame: Frame, name: string): unknown[] {
  const index = frame.fields.findIndex((field) => field.name === name);
  return frame.values[index] ?? [];
}

for (const server of servers) {
  describe.skipIf(!live)(`a week of an hourly histogram on the dev ${server.name}`, () => {
    const connection = server.kind.open({
      config: server.kind.configSchema.parse(server.source.config),
      secret: server.kind.secretSchema.parse(server.source.secret),
    });
    afterAll(() => connection.close());

    /**
     * Runs an hourly histogram of the player events over the week, bound as a panel's query is.
     * The time field of `core_events` takes epoch milliseconds only.
     *
     * @param histogram - Settings of the histogram beyond its field and width.
     * @param aggs - The aggregations under it.
     * @returns The frame.
     */
    async function hourly(histogram: Record<string, unknown>, aggs: Record<string, unknown>) {
      const time = {
        date_histogram: { field: '@timestamp', fixed_interval: '1h', ...histogram },
        aggs,
      };
      const body = { size: 0, query: { bool: { filter: [inPeriod] } }, aggs: { time } };
      const bound = bindSearch({ index: 'core_events', body }, {}, week);
      const signal = AbortSignal.timeout(20_000);
      const execution = { refId: 'A', signal, timeoutMs: 20_000, maxRows: 5000, timeRange: week };
      const [frame] = (await connection.execute(bound, execution)) as Frame[];
      return frame as Frame;
    }

    test('has a bucket for every hour of the week, empty or not', async () => {
      const metrics = {
        events: { value_count: { field: 'event_name' } },
        bitrate: { avg: { field: 'data.bitrate' } },
      };
      const frame = await hourly({}, metrics);
      const times = column(frame, 'time') as number[];
      expect(times).toHaveLength(7 * 24 + 1);
      expect(times[0]).toBe(Math.floor(week.from.getTime() / hour) * hour);
      expect(times.at(-1)).toBe(Math.floor((week.to.getTime() - 1) / hour) * hour);
      const events = column(frame, 'events') as number[];
      expect(events[0]).toBe(0);
      expect(events.at(-1)).toBeGreaterThan(0);
      // A count over nothing is 0; an average over nothing is unknown.
      expect(column(frame, 'bitrate')[0]).toBeNull();
      expect(column(frame, 'bitrate').at(-1)).toBeGreaterThan(0);
    });

    test('keeps only the hours with events when the query asks for that', async () => {
      const frame = await hourly({ min_doc_count: 1 }, {});
      const times = column(frame, 'time') as number[];
      expect(times.length).toBeGreaterThan(0);
      expect(times.length).toBeLessThan(7 * 24);
      expect((column(frame, 'count') as number[]).every((count) => count > 0)).toBe(true);
    });

    test('reads the bounds a query writes itself with the range', async () => {
      const own = { min: { $var: '__from' }, max: { $var: '__to' } };
      const extended = await hourly({ extended_bounds: own }, {});
      expect(column(extended, 'time')).toHaveLength(7 * 24 + 1);
      const hard = await hourly({ hard_bounds: own, min_doc_count: 0 }, {});
      expect(column(hard, 'time').length).toBeGreaterThan(0);
    });
  });
}
