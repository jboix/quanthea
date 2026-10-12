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

/** Requests are not about deploys, which the logs also hold. */
const requests = { field: 'route', op: '!=', value: 'deploy' };

for (const server of servers) {
  describe.skipIf(!live)(`the search builders on the dev ${server.name}`, () => {
    const connection = server.kind.open({
      config: server.kind.configSchema.parse(server.source.config),
      secret: server.kind.secretSchema.parse(server.source.secret),
    });
    afterAll(() => connection.close());

    /**
     * Builds a request over the dev logs, binds it and runs it over the incident.
     *
     * @param data - The request, without its connector and index.
     * @param variables - The variable values.
     * @returns The frame.
     */
    async function run(data: Record<string, unknown>, variables: Variables = {}): Promise<Frame> {
      const parsed = dataSchema.parse({ connector: 'logs', index: 'logs-*', ...data });
      const [query] = buildData(parsed).queries;
      if (!query) throw new Error('Nothing was built.');
      const bound = bindTemplate(query, variables, timeRange);
      const signal = AbortSignal.timeout(20_000);
      const execution = { refId: 'A', signal, timeoutMs: 20_000, maxRows: 5000, timeRange };
      const [frame] = await connection.execute(bound, execution);
      if (!frame) throw new Error('No frame.');
      return frame;
    }

    test('counts errors over time for a service variable, peaking after the deploy', async () => {
      const frame = await run(
        {
          kind: 'search-series',
          filters: [
            { field: 'service', value: '$service' },
            { field: 'level', value: 'error' },
          ],
          interval: '$interval',
        },
        { service: { value: 'checkout-svc' }, interval: { value: '5m', duration: true } },
      );
      expect(frame.fields.map((field) => field.name)).toEqual(['time', 'value']);
      const [times, counts] = frame.values as [number[], number[]];
      const peak = times[counts.indexOf(Math.max(...counts))] ?? 0;
      expect(peak - incident.getTime()).toBeGreaterThanOrEqual(5 * 60_000);
      expect(peak - incident.getTime()).toBeLessThanOrEqual(25 * 60_000);
    });

    test('gives the error rate over time and the success rate per service', async () => {
      const rate = await run({
        kind: 'search-ratio',
        filters: [{ field: 'service', value: 'checkout-svc' }],
        match: [{ field: 'level', value: 'error' }],
        of: [requests],
        interval: '5m',
      });
      const [, shares] = rate.values as [number[], number[]];
      expect(Math.max(...shares)).toBeGreaterThan(0.03);
      expect(Math.max(...shares)).toBeLessThan(0.5);
      const success = await run({
        kind: 'search-ratio',
        match: [{ field: 'level', value: 'error' }],
        of: [requests],
        over: 'range',
        by: 'service',
        complement: true,
        counts: true,
      });
      expect(success.fields.map((field) => field.name)).toEqual([
        'service',
        'matching',
        'total',
        'value',
      ]);
      const [services, errors, totals, rates] = success.values as [
        string[],
        number[],
        number[],
        number[],
      ];
      expect(services[0]).toBe('checkout-svc');
      expect(rates[0]).toBeCloseTo(1 - (errors[0] ?? 0) / (totals[0] ?? 1), 6);
    });

    test('breaks down by percentile, counts, bins and lists the latest errors', async () => {
      const p95 = await run({
        kind: 'search-breakdown',
        by: 'service',
        measure: { fn: 'percentiles', field: 'duration_ms', percents: [95] },
      });
      expect(p95.fields.map((field) => field.name)).toEqual(['service', 'value p95']);
      const stat = await run({
        kind: 'search-stat',
        filters: [{ field: 'level', value: 'error' }],
      });
      expect((stat.values[0] as number[])[0]).toBeGreaterThan(0);
      const bins = await run({
        kind: 'search-histogram',
        field: 'duration_ms',
        width: 250,
        filters: [requests],
      });
      expect((bins.values[0] as number[]).every((bin) => bin % 250 === 0)).toBe(true);
      const rows = await run({
        kind: 'search-rows',
        fields: ['@timestamp', 'service', 'message'],
        filters: [{ field: 'level', value: 'error' }],
        limit: 5,
      });
      const times = rows.values[rows.fields.findIndex((field) => field.name === '@timestamp')];
      expect(times).toHaveLength(5);
      expect([...(times as number[])].sort((a, b) => b - a)).toEqual(times as number[]);
    });

    /**
     * Runs a builder over the dev player events, whose time field takes epoch milliseconds only.
     *
     * @param data - The request, without its connector and index.
     * @returns The frame.
     */
    function onEvents(data: Record<string, unknown>): Promise<Frame> {
      return run({ index: 'core_events', ...data });
    }

    test('measures the player events over time and over the range', async () => {
      const series = await onEvents({ kind: 'search-series', by: 'event_name', interval: '5m' });
      expect(series.fields.map((field) => [field.name, field.type])).toEqual([
        ['time', 'time'],
        ['series', 'string'],
        ['value', 'number'],
      ]);
      const [times, names] = series.values as [number[], string[]];
      expect(Math.min(...times)).toBeGreaterThanOrEqual(timeRange.from.getTime() - 5 * 60_000);
      expect(Math.max(...times)).toBeLessThanOrEqual(timeRange.to.getTime());
      expect(new Set(names)).toEqual(new Set(['START', 'HEARTBEAT', 'STOP', 'ERROR']));
      const refused = await onEvents({
        kind: 'search-ratio',
        match: [{ field: 'data.business_error', value: 'true' }],
        of: [{ field: 'event_name', value: 'ERROR' }],
        over: 'range',
        by: 'session.player.platform',
      });
      const [platforms, shares] = refused.values as [string[], number[]];
      expect([...platforms].sort()).toEqual(['Android', 'Apple', 'Web']);
      expect(shares.every((share) => share > 0 && share <= 1)).toBe(true);
      expect(shares[platforms.indexOf('Web')]).toBeLessThan(0.9);
      const sessions = await onEvents({
        kind: 'search-stat',
        measure: { fn: 'cardinality', field: 'session_id' },
      });
      expect((sessions.values[0] as number[])[0]).toBeGreaterThan(200);
    });

    test('breaks the player events down, bins them and lists the latest', async () => {
      const starts = [{ field: 'event_name', value: 'START' }];
      const slow = await onEvents({
        kind: 'search-breakdown',
        by: 'session.media.bu',
        measure: { fn: 'percentiles', field: 'session.qoe_timings.total', percents: [95] },
        filters: starts,
      });
      expect(slow.fields.map((field) => field.name)).toEqual(['session.media.bu', 'value p95']);
      expect(slow.meta.rowCount).toBe(4);
      const bins = await onEvents({
        kind: 'search-histogram',
        field: 'session.qoe_timings.total',
        width: 250,
        filters: starts,
      });
      expect((bins.values[0] as number[]).every((bin) => bin % 250 === 0)).toBe(true);
      const rows = await onEvents({
        kind: 'search-rows',
        fields: ['@timestamp', 'user_ip', 'data.error_type'],
        filters: [{ field: 'event_name', value: 'ERROR' }],
        limit: 5,
      });
      const column = (name: string) =>
        rows.values[rows.fields.findIndex((field) => field.name === name)] ?? [];
      const instants = column('@timestamp') as number[];
      expect(instants).toHaveLength(5);
      expect([...instants].sort((a, b) => b - a)).toEqual(instants);
      expect(instants.every((time) => time >= timeRange.from.getTime())).toBe(true);
      expect(instants.every((time) => time <= timeRange.to.getTime())).toBe(true);
      expect(column('user_ip').every((address) => /^198\.18\./.test(String(address)))).toBe(true);
    });
  });
}
