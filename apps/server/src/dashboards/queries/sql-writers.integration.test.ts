import { afterAll, describe, expect, test } from 'bun:test';
import type { Frame, PanelQuery } from '@querent/shared';
import type { AnyConnectorKind } from '../../connectors/_shared/index.ts';
import {
  devClickhouseAs,
  devIncidentStart,
  devInfluxdb,
  devMysqlServers,
  devTimescale,
  devTrino,
  integrationFor,
} from '../../connectors/_shared/test/dev-sources.ts';
import { clickhouseConnector } from '../../connectors/clickhouse/clickhouse-connector.ts';
import { influxdbConnector } from '../../connectors/influxdb/influxdb-connector.ts';
import { mariadbConnector } from '../../connectors/mysql/mariadb-connector.ts';
import { mysqlConnector } from '../../connectors/mysql/mysql-connector.ts';
import { postgresConnector } from '../../connectors/postgres/postgres-connector.ts';
import { trinoConnector } from '../../connectors/trino/trino-connector.ts';
import { bindTemplate } from '../../query/bind.ts';
import type { SqlFlavor } from '../../query/sql-dialects.ts';
import type { Variables } from '../../query/variables.ts';
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';
import { markersQuery } from './sql.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/** A dev database the builders run against, beyond the dev Postgres the core tests use. */
interface Target {
  /** The server, in test titles. */
  readonly name: string;
  /** Whether its set of data sources is up. */
  readonly live: boolean;
  /** Its connector kind. */
  readonly kind: AnyConnectorKind;
  /** Its SQL dialect. */
  readonly dialect: SqlFlavor;
  /** The read-only configuration and secret. */
  readonly source: { readonly config: unknown; readonly secret: unknown };
}

const targets: Target[] = [
  {
    name: 'TimescaleDB',
    live: integrationFor('timescale'),
    kind: postgresConnector,
    dialect: 'postgres',
    source: devTimescale,
  },
  ...devMysqlServers.map((server) => ({
    name: server.name,
    live: integrationFor('mysql'),
    kind: server.name === 'MariaDB' ? mariadbConnector : mysqlConnector,
    dialect: 'mysql' as const,
    source: server.reader,
  })),
  {
    name: 'ClickHouse',
    live: integrationFor('clickhouse'),
    kind: clickhouseConnector,
    dialect: 'clickhouse',
    source: devClickhouseAs('dash_ro'),
  },
  {
    name: 'Trino',
    live: integrationFor('trino'),
    kind: trinoConnector,
    dialect: 'trino',
    source: devTrino,
  },
];

for (const target of targets) {
  describe.skipIf(!target.live)(`the SQL builders on the dev ${target.name}`, () => {
    const context = { saved: [], dialectOf: () => target.dialect };
    const connection = target.kind.open({
      config: target.kind.configSchema.parse(target.source.config),
      secret: target.kind.secretSchema.parse(target.source.secret),
    });
    afterAll(() => connection.close());

    /**
     * Binds a built query for the dialect and runs it over the incident.
     *
     * @param query - The built query.
     * @param variables - The variable values.
     * @returns The frame.
     */
    async function run(query: PanelQuery | undefined, variables: Variables = {}): Promise<Frame> {
      if (!query) throw new Error('Nothing was built.');
      const bound = bindTemplate(query, variables, timeRange, { dialect: target.dialect });
      const signal = AbortSignal.timeout(10_000);
      const execution = { refId: 'A', signal, timeoutMs: 10_000, maxRows: 5000, timeRange };
      const [frame] = await connection.execute(bound, execution);
      if (!frame) throw new Error('No frame.');
      return frame;
    }

    /**
     * Builds a data request for the dev connector.
     *
     * @param data - The request, without its connector.
     * @returns The first query.
     */
    function built(data: Record<string, unknown>): PanelQuery | undefined {
      return buildData(dataSchema.parse({ connector: 'shop', ...data }), context).queries[0];
    }

    test('buckets the failed orders of the incident, peaking between 12:12 and 12:22', async () => {
      const query = built({
        kind: 'sql-series',
        table: 'orders',
        time: 'created_at',
        bucket: '$interval',
        by: 'status',
        filters: [{ field: 'status', value: '$status' }],
      });
      const frame = await run(query, {
        interval: { value: '5m', duration: true },
        status: { value: ['failed'] },
      });
      expect(frame.fields.map((field) => [field.name, field.type])).toEqual([
        ['time', 'time'],
        ['series', 'string'],
        ['value', 'number'],
      ]);
      const [times, , counts] = frame.values as [number[], string[], number[]];
      const peak = times[counts.indexOf(Math.max(...counts))] ?? 0;
      expect(peak - incident.getTime()).toBeGreaterThanOrEqual(10 * 60_000);
      expect(peak - incident.getTime()).toBeLessThanOrEqual(20 * 60_000);
      // PostgreSQL buckets from the start of the range (date_bin); the others from the epoch.
      const origin = target.dialect === 'postgres' ? timeRange.from.getTime() : 0;
      expect(times.every((time) => (time - origin) % (5 * 60_000) === 0)).toBe(true);
    });

    test('breaks down, counts and lists with regular expressions and escaped literals', async () => {
      const breakdown = await run(
        built({
          kind: 'sql-breakdown',
          table: 'orders',
          time: 'created_at',
          by: 'failure_reason',
          filters: [{ field: 'failure_reason', op: '=~', value: '^payment' }],
        }),
      );
      expect([...(breakdown.values[0] as string[])].sort()).toEqual([
        'payment_gateway_502',
        'payment_gateway_timeout',
      ]);
      const stat = await run(
        built({
          kind: 'sql-stat',
          table: 'orders',
          filters: [{ field: 'status', value: "\\' OR 1=1 -- " }],
        }),
      );
      expect(stat.values[0]).toEqual([0]);
      const rows = await run(
        built({
          kind: 'sql-rows',
          table: 'deploys',
          time: 'deployed_at',
          columns: ['id', 'version'],
          limit: 3,
        }),
      );
      expect(rows.values[0]).toEqual([482, 481]);
    });

    test('gives the failure rate over time and the success rate per service', async () => {
      const rate = await run(
        built({
          kind: 'sql-ratio',
          table: 'orders',
          time: 'created_at',
          match: [{ field: 'status', value: 'failed' }],
          bucket: '$interval',
        }),
        { interval: { value: '10m', duration: true } },
      );
      const [, shares] = rate.values as [number[], number[]];
      expect(Math.max(...shares.map(Number))).toBeGreaterThan(0.05);
      expect(Math.max(...shares.map(Number))).toBeLessThanOrEqual(1);
      const success = await run(
        built({
          kind: 'sql-ratio',
          table: 'orders',
          time: 'created_at',
          over: 'range',
          by: 'service',
          match: [{ field: 'status', value: 'failed' }],
          complement: true,
          counts: true,
        }),
      );
      expect(success.fields.map((field) => field.name)).toEqual([
        'service',
        'matching',
        'total',
        'value',
      ]);
      const [, failed, total, value] = success.values.map((column) => Number(column[0]));
      expect(value).toBeCloseTo(1 - (failed ?? 0) / (total ?? 1), 6);
    });

    test('marks the deploys of the time range', async () => {
      const query = markersQuery(
        {
          label: 'deploy',
          connector: 'shop',
          table: 'deploys',
          time: 'deployed_at',
          text: 'version',
          filters: [],
        },
        context,
      );
      const frame = await run(query);
      expect(frame.values[1]).toEqual(['2.14.0', '2.13.4']);
    });
  });
}

describe.skipIf(!integrationFor('influxdb'))('the SQL builders on the dev InfluxDB 3', () => {
  const connection = influxdbConnector.open({
    config: influxdbConnector.configSchema.parse(devInfluxdb.config),
    secret: influxdbConnector.secretSchema.parse(devInfluxdb.secret),
  });
  afterAll(() => connection.close());

  test('buckets the errors of checkout-svc, with an interval variable, peaking after the deploy', async () => {
    const [query] = buildData(
      dataSchema.parse({
        kind: 'sql-series',
        connector: 'telemetry',
        table: 'http_requests',
        time: 'time',
        bucket: '$interval',
        measure: { fn: 'sum', column: 'errors' },
        filters: [{ field: 'service', value: '$service' }],
      }),
      { saved: [], dialectOf: () => 'influxdb' },
    ).queries;
    if (!query) throw new Error('Nothing was built.');
    const variables = {
      interval: { value: '5m', duration: true },
      service: { value: ['checkout-svc'] },
    };
    const bound = bindTemplate(query, variables, timeRange, { dialect: 'influxdb' });
    const signal = AbortSignal.timeout(10_000);
    const [frame] = await connection.execute(bound, {
      refId: 'A',
      signal,
      timeoutMs: 10_000,
      maxRows: 5000,
      timeRange,
    });
    const [times, values] = (frame?.values ?? [[], []]) as [number[], number[]];
    const peak = times[values.indexOf(Math.max(...values))] ?? 0;
    expect(peak - incident.getTime()).toBeGreaterThanOrEqual(5 * 60_000);
    expect(peak - incident.getTime()).toBeLessThanOrEqual(25 * 60_000);
  });
});
