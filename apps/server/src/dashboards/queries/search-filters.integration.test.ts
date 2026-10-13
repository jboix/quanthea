import { afterAll, describe, expect, test } from 'bun:test';
import type { PanelQuery } from '@quanthea/shared';
import type { AnyConnectorKind } from '../../connectors/_shared/index.ts';
import {
  devElasticsearch,
  devIncidentStart,
  devOpensearch,
  integrationFor,
} from '../../connectors/_shared/test/dev-sources.ts';
import { elasticsearchConnector } from '../../connectors/search/elasticsearch-connector.ts';
import { opensearchConnector } from '../../connectors/search/opensearch-connector.ts';
import { bindTemplate } from '../../query/bind.ts';
import type { Variables } from '../../query/variables.ts';
import { inRange } from './search-body.ts';
import { boolQuery, searchFiltersSchema } from './search-filters.ts';

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

const platform = 'session.player.platform';
const total = 'session.qoe_timings.total';

for (const server of servers) {
  describe.skipIf(!live)(`the search filters on the dev ${server.name}`, () => {
    const connection = server.kind.open({
      config: server.kind.configSchema.parse(server.source.config),
      secret: server.kind.secretSchema.parse(server.source.secret),
    });
    afterAll(() => connection.close());

    /**
     * Counts the dev player events of the incident that pass filters.
     *
     * @param filters - The filters, as a request writes them.
     * @param variables - The variable values.
     * @returns How many events pass.
     */
    async function count(
      filters: readonly Record<string, unknown>[],
      variables: Variables = {},
    ): Promise<number> {
      const query = boolQuery(searchFiltersSchema.parse(filters), [inRange('@timestamp')]);
      const body = { size: 0, query, aggs: { value: { value_count: { field: '@timestamp' } } } };
      const template: PanelQuery = {
        refId: 'A',
        connector: 'events',
        language: 'search',
        index: 'core_events',
        body,
      };
      const signal = AbortSignal.timeout(20_000);
      const execution = { refId: 'A', signal, timeoutMs: 20_000, maxRows: 5000, timeRange };
      const bound = bindTemplate(template, variables, timeRange);
      const [frame] = await connection.execute(bound, execution);
      return Number((frame?.values[0] as number[] | undefined)?.[0]);
    }

    test('keep a list of values, of literals or of a multi-value variable', async () => {
      const starts = await count([{ field: 'event_name', value: 'START' }]);
      const stops = await count([{ field: 'event_name', value: 'STOP' }]);
      expect(starts).toBeGreaterThan(0);
      expect(stops).toBeGreaterThan(0);
      const listed = [{ field: 'event_name', op: 'in', values: ['START', 'STOP'] }];
      expect(await count(listed)).toBe(starts + stops);
      const chosen = [{ field: 'event_name', op: 'in', values: ['$names'] }];
      expect(await count(chosen, { names: { value: ['START', 'STOP'] } })).toBe(starts + stops);
    });

    test('cut a timing with a bound, written or from a variable', async () => {
      const all = await count([{ field: total, op: 'exists' }]);
      const slow = await count([{ field: total, op: '>=', value: '1500' }]);
      const fast = await count([{ field: total, op: '<', value: '1500' }]);
      expect(slow).toBeGreaterThan(0);
      expect(fast).toBeGreaterThan(0);
      expect(slow + fast).toBe(all);
      const above = await count([{ field: total, op: '>', value: '$bound' }], {
        bound: { value: '1500' },
      });
      const upTo = await count([{ field: total, op: '<=', value: '1500' }]);
      expect(above + upTo).toBe(all);
      const band = await count([
        { field: total, op: '>=', value: '1000' },
        { field: total, op: '<', value: '1500' },
      ]);
      expect(band).toBe(fast - (await count([{ field: total, op: '<', value: '1000' }])));
    });

    test('keep the documents that have a field, and those a wildcard matches', async () => {
      const everything = await count([]);
      const typed = await count([{ field: 'data.error_type', op: 'exists' }]);
      expect(typed).toBeGreaterThan(0);
      expect(typed).toBeLessThan(everything);
      const apple = await count([{ field: platform, value: 'Apple' }]);
      const android = await count([{ field: platform, value: 'Android' }]);
      expect(await count([{ field: platform, op: 'like', value: 'A*' }])).toBe(apple + android);
      expect(await count([{ field: platform, op: 'like', value: 'A??le' }])).toBe(apple);
    });

    test('keep the documents one of several filters keeps', async () => {
      const web = await count([{ field: platform, value: 'Web' }]);
      const errors = await count([{ field: 'event_name', value: 'ERROR' }]);
      const both = await count([
        { field: platform, value: 'Web' },
        { field: 'event_name', value: 'ERROR' },
      ]);
      const either = await count([
        {
          any: [
            { field: platform, value: 'Web' },
            { field: 'event_name', value: 'ERROR' },
          ],
        },
      ]);
      expect(either).toBe(web + errors - both);
      const everything = await count([]);
      const notWebOrError = await count([
        {
          any: [
            { field: platform, op: '!=', value: 'Web' },
            { field: 'event_name', value: 'ERROR' },
          ],
        },
      ]);
      expect(notWebOrError).toBe(everything - web + both);
    });
  });
}
