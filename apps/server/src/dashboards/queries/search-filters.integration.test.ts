import { afterAll, describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/shared';
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
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';

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
     * Builds a request over the dev player events, binds it and runs it over the incident.
     *
     * @param data - The request, without its connector and index.
     * @param variables - The variable values.
     * @returns The frame.
     */
    async function run(data: Record<string, unknown>, variables: Variables = {}): Promise<Frame> {
      const parsed = dataSchema.parse({ connector: 'events', index: 'core_events', ...data });
      const [query] = buildData(parsed).queries;
      if (!query) throw new Error('Nothing was built.');
      const signal = AbortSignal.timeout(20_000);
      const execution = { refId: 'A', signal, timeoutMs: 20_000, maxRows: 5000, timeRange };
      const [frame] = await connection.execute(
        bindTemplate(query, variables, timeRange),
        execution,
      );
      if (!frame) throw new Error('No frame.');
      return frame;
    }

    /**
     * Counts the dev player events of the incident that pass filters, with `search-stat`.
     *
     * @param filters - The filters, as a request writes them.
     * @param variables - The variable values.
     * @returns How many events pass.
     */
    async function count(
      filters: readonly Record<string, unknown>[],
      variables: Variables = {},
    ): Promise<number> {
      const frame = await run({ kind: 'search-stat', filters }, variables);
      return Number((frame.values[0] as number[] | undefined)?.[0]);
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
        { field: platform, value: 'Web', any: 'a' },
        { field: 'event_name', value: 'ERROR', any: 'a' },
      ]);
      expect(either).toBe(web + errors - both);
      const everything = await count([]);
      const notWebOrError = await count([
        { field: platform, op: '!=', value: 'Web', any: 'a' },
        { field: 'event_name', value: 'ERROR', any: 'a' },
      ]);
      expect(notWebOrError).toBe(everything - web + both);
    });

    test('filter the same way in every builder, and in the part and the whole of a ratio', async () => {
      const starts = { field: 'event_name', value: 'START' };
      const slow = { field: total, op: '>', value: '1500' };
      const listed = { field: platform, op: 'in', values: ['$platforms'] };
      const variables = { platforms: { value: ['Web', 'Apple'] } };
      const all = await count([starts, listed], variables);
      const matching = await count([starts, listed, slow], variables);
      expect(matching).toBeGreaterThan(0);
      const ratio = await run(
        {
          kind: 'search-ratio',
          match: [starts, slow],
          of: [starts],
          filters: [listed],
          over: 'range',
        },
        variables,
      );
      expect((ratio.values[0] as number[])[0]).toBeCloseTo(matching / all, 6);
      const perPlatform = await run(
        { kind: 'search-breakdown', by: platform, filters: [starts, listed, slow] },
        variables,
      );
      const [platforms, counts] = perPlatform.values as [string[], number[]];
      expect([...platforms].sort()).toEqual(['Apple', 'Web']);
      expect(counts.reduce((sum, each) => sum + each, 0)).toBe(matching);
      const rows = await run(
        { kind: 'search-rows', fields: [platform, total], filters: [starts, listed, slow] },
        variables,
      );
      const timings = rows.values[rows.fields.findIndex((field) => field.name === total)];
      expect((timings as number[]).length).toBeGreaterThan(0);
      expect((timings as number[]).every((timing) => timing > 1500)).toBe(true);
    });
  });
}
