import { afterAll, describe, expect, test } from 'bun:test';
import type { Frame, PanelQuery } from '@querent/shared';
import {
  devIncidentStart,
  devMysqlServers,
  integrationFor,
} from '../../connectors/_shared/test/dev-sources.ts';
import { mysqlConnector } from '../../connectors/mysql/mysql-connector.ts';
import { bindTemplate } from '../../query/bind.ts';
import type { Variables } from '../../query/variables.ts';
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';
import { markersQuery } from './sql.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};
const context = { saved: [], dialectOf: () => 'mysql' as const };

for (const server of devMysqlServers) {
  describe.skipIf(!integrationFor('mysql'))(`the SQL builders on the dev ${server.name}`, () => {
    const connection = mysqlConnector.open({
      config: mysqlConnector.configSchema.parse(server.reader.config),
      secret: mysqlConnector.secretSchema.parse(server.reader.secret),
    });
    afterAll(() => connection.close());

    /**
     * Binds a built query for MySQL and runs it over the incident.
     *
     * @param query - The built query.
     * @param variables - The variable values.
     * @returns The frame.
     */
    async function run(query: PanelQuery | undefined, variables: Variables = {}): Promise<Frame> {
      if (!query) throw new Error('Nothing was built.');
      const bound = bindTemplate(query, variables, timeRange, { dialect: 'mysql' });
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
      expect(times.every((time) => time % (5 * 60_000) === 0)).toBe(true);
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
