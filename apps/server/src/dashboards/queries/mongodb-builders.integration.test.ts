import { afterAll, describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/shared';
import {
  devIncidentStart,
  devMongodb,
  integrationFor,
} from '../../connectors/_shared/test/dev-sources.ts';
import { mongodbConnector } from '../../connectors/mongodb/mongodb-connector.ts';
import { bindTemplate } from '../../query/bind.ts';
import type { Variables } from '../../query/variables.ts';
import { buildData } from './build.ts';
import { dataSchema } from './request.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

describe.skipIf(!integrationFor('mongodb'))('the MongoDB builders on the dev MongoDB', () => {
  const connection = mongodbConnector.open({
    config: mongodbConnector.configSchema.parse(devMongodb.config),
    secret: mongodbConnector.secretSchema.parse(devMongodb.secret),
  });
  afterAll(() => connection.close());

  /**
   * Builds a request over the orders, binds it and runs it over the incident.
   *
   * @param data - The request, without its connector and collection.
   * @param variables - The variable values.
   * @returns The frame.
   */
  async function run(data: Record<string, unknown>, variables: Variables = {}): Promise<Frame> {
    const request = { connector: 'shop', collection: 'orders', time: 'created_at', ...data };
    const [query] = buildData(dataSchema.parse(request)).queries;
    if (!query) throw new Error('Nothing was built.');
    const bound = bindTemplate(query, variables, timeRange);
    const signal = AbortSignal.timeout(20_000);
    const execution = { refId: 'A', signal, timeoutMs: 20_000, maxRows: 5000, timeRange };
    const [frame] = await connection.execute(bound, execution);
    if (!frame) throw new Error('No frame.');
    return frame;
  }

  /**
   * The values of a column.
   *
   * @param frame - The frame.
   * @param name - The column.
   * @returns Its values.
   */
  function column(frame: Frame, name: string): unknown[] {
    return frame.values[frame.fields.findIndex((field) => field.name === name)] ?? [];
  }

  test('counts failed orders over an interval variable, peaking after the deploy', async () => {
    const frame = await run(
      {
        kind: 'mongodb-series',
        filters: [{ field: 'status', value: '$status' }],
        interval: '$interval',
      },
      { status: { value: ['failed'] }, interval: { value: '5m', duration: true } },
    );
    expect(frame.fields).toEqual([
      { name: 'time', type: 'time' },
      { name: 'value', type: 'number' },
    ]);
    const times = column(frame, 'time') as number[];
    const counts = column(frame, 'value') as number[];
    expect(times.every((time) => time % 300_000 === 0)).toBe(true);
    const peak = (times[counts.indexOf(Math.max(...counts))] ?? 0) - incident.getTime();
    expect(peak).toBeGreaterThanOrEqual(0);
    expect(peak).toBeLessThanOrEqual(30 * 60_000);
  });

  test('gives the failure rate over time and per country with its counts', async () => {
    const overTime = await run({
      kind: 'mongodb-ratio',
      match: [{ field: 'status', value: 'failed' }],
      interval: '10m',
    });
    expect(Math.max(...(column(overTime, 'value') as number[]))).toBeGreaterThan(0.03);
    const perCountry = await run({
      kind: 'mongodb-ratio',
      match: [{ field: 'status', value: 'failed' }],
      over: 'range',
      by: 'customer.country',
      complement: true,
      counts: true,
    });
    expect(perCountry.fields.map((field) => field.name)).toEqual([
      'customer.country',
      'matching',
      'total',
      'value',
    ]);
    const [matching = 0, total = 1, value = 0] = ['matching', 'total', 'value'].map(
      (name) => column(perCountry, name)[0] as number,
    );
    expect(value).toBeCloseTo(1 - matching / total, 6);
  });

  test('breaks down by percentile, sums decimals, bins and lists the latest orders', async () => {
    const reasons = await run({
      kind: 'mongodb-breakdown',
      by: 'failure_reason',
      filters: [{ field: 'status', value: 'failed' }],
    });
    expect(reasons.fields.map((field) => field.name)).toEqual(['failure_reason', 'value']);
    expect(column(reasons, 'failure_reason')[0]).toBe('payment_gateway_502');
    const p50 = await run({
      kind: 'mongodb-breakdown',
      by: 'customer.country',
      measure: { fn: 'percentiles', field: 'total', percents: [50] },
    });
    expect(p50.fields.map((field) => field.name)).toEqual(['customer.country', 'value p50']);
    const revenue = await run({ kind: 'mongodb-stat', measure: { fn: 'sum', field: 'total' } });
    expect(column(revenue, 'value')[0]).toBeGreaterThan(0);
    const bins = await run({ kind: 'mongodb-histogram', field: 'total', width: 25 });
    expect((column(bins, 'bin') as number[]).every((bin) => bin % 25 === 0)).toBe(true);
    const latest = await run({
      kind: 'mongodb-rows',
      fields: ['created_at', 'status', 'customer.country'],
      limit: 5,
    });
    const times = column(latest, 'created_at') as number[];
    expect(times).toHaveLength(5);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
