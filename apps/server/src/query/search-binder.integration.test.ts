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
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/** Each search kind and its dev server. */
const servers: {
  name: string;
  kind: AnyConnectorKind;
  source: { config: unknown; secret: unknown };
}[] = [
  { name: 'Elasticsearch', kind: elasticsearchConnector, source: devElasticsearch },
  { name: 'OpenSearch', kind: opensearchConnector, source: devOpensearch },
];

for (const server of servers) {
  describe.skipIf(!live)(`dates in a search on the dev ${server.name}`, () => {
    const connection = server.kind.open({
      config: server.kind.configSchema.parse(server.source.config),
      secret: server.kind.secretSchema.parse(server.source.secret),
    });
    afterAll(() => connection.close());

    /**
     * Counts the player events a range keeps, binding the body as a panel's query is bound. The
     * time field of `core_events` takes epoch milliseconds only.
     *
     * @param bounds - The bounds of `@timestamp`.
     * @returns The count.
     */
    async function eventsWithin(bounds: Record<string, unknown>): Promise<number> {
      const body = {
        size: 0,
        track_total_hits: true,
        query: { bool: { filter: [{ range: { '@timestamp': bounds } }] } },
        aggs: { events: { value_count: { field: 'event_name' } } },
      };
      const bound = bindSearch({ index: 'core_events', body }, {}, timeRange);
      const signal = AbortSignal.timeout(20_000);
      const execution = { refId: 'A', signal, timeoutMs: 20_000, maxRows: 5000, timeRange };
      const [frame] = (await connection.execute(bound, execution)) as Frame[];
      return Number(frame?.values[0]?.[0]);
    }

    test('a date written as text is read by a field that takes epoch milliseconds', async () => {
      const from = timeRange.from.getTime();
      const to = timeRange.to.getTime();
      const asNumbers = await eventsWithin({ gte: from, lt: to });
      expect(asNumbers).toBeGreaterThan(0);
      const seconds = (instant: number) => new Date(instant).toISOString().replace('.000Z', 'Z');
      expect(await eventsWithin({ gte: seconds(from), lt: seconds(to) })).toBe(asNumbers);
      expect(await eventsWithin({ gte: seconds(from), lt: to })).toBe(asNumbers);
      const variables = { gte: { $var: '__from' }, lt: { $var: '__to' } };
      expect(await eventsWithin(variables)).toBe(asNumbers);
    });

    test('a date that names its own format is left to the server', async () => {
      const bounds = { gte: timeRange.from.toISOString(), format: 'epoch_millis' };
      await expect(eventsWithin(bounds)).rejects.toThrow();
    });
  });
}
