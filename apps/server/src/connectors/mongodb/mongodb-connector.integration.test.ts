import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import type {
  ConnectorError,
  ConnectorInstance,
  ExecutionContext,
  MongodbQuery,
} from '../_shared/index.ts';
import {
  devIncidentStart,
  devMongodb,
  devMongodbOwner,
  integrationFor,
} from '../_shared/test/dev-sources.ts';
import { mongodbConnector } from './mongodb-connector.ts';

const live = integrationFor('mongodb');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/**
 * A bound pipeline.
 *
 * @param collection - The collection.
 * @param pipeline - The stages, in Extended JSON.
 * @returns The query.
 */
function mongodb(collection: string, ...pipeline: Record<string, unknown>[]): MongodbQuery {
  return { language: 'mongodb', collection, pipeline };
}

/**
 * An execution context over the incident.
 *
 * @param overrides - Fields to replace.
 * @returns The context.
 */
function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    refId: 'A',
    signal: AbortSignal.timeout(10_000),
    timeoutMs: 10_000,
    maxRows: 1000,
    timeRange,
    ...overrides,
  };
}

/**
 * Opens the dev MongoDB.
 *
 * @param source - The configuration and secret.
 * @returns The connection.
 */
function open(source: { config: unknown; secret: unknown }): ConnectorInstance {
  return mongodbConnector.open({
    config: mongodbConnector.configSchema.parse(source.config),
    secret: mongodbConnector.secretSchema.parse(source.secret),
  });
}

/** The incident's range as Extended JSON dates, as the binder writes them. */
const inRange = {
  $gte: { $date: timeRange.from.toISOString() },
  $lt: { $date: timeRange.to.toISOString() },
};

testConnectorConformance(mongodbConnector, {
  config: devMongodb.config,
  secret: devMongodb.secret,
  query: mongodb('orders', { $match: { status: 'failed' } }, { $project: { _id: 0, total: 1 } }),
  invalidQuery: mongodb('orders', { $bogus: {} }),
  sampleField: { entity: 'orders', field: 'status' },
  timeRange,
  live,
});

describe.skipIf(!live)('mongodb connector against the dev MongoDB', () => {
  let reader: ConnectorInstance;
  let owner: ConnectorInstance;

  beforeAll(() => {
    reader = open(devMongodb);
    owner = open(devMongodbOwner);
  });

  afterAll(async () => {
    await reader.close();
    await owner.close();
  });

  /**
   * Runs a pipeline and returns its frame.
   *
   * @param query - The pipeline.
   * @returns The frame.
   */
  async function frameOf(query: MongodbQuery) {
    const [frame] = await reader.execute(query, context());
    if (!frame) throw new Error('No frame.');
    return frame;
  }

  test('names the server and says whether the user could write', async () => {
    const health = await reader.test(AbortSignal.timeout(10_000));
    expect(health).toMatchObject({ ok: true, readOnly: true });
    expect(health.message).toMatch(/^MongoDB \d+\.\d+\.\d+\. User dash_ro cannot write\.$/);
    expect(await owner.test(AbortSignal.timeout(10_000))).toMatchObject({
      ok: true,
      readOnly: false,
    });
  });

  test('buckets failed orders over time, with the incident in them', async () => {
    const frame = await frameOf(
      mongodb(
        'orders',
        { $match: { status: 'failed', created_at: inRange } },
        {
          $group: {
            _id: { $dateTrunc: { date: '$created_at', unit: 'minute', binSize: 5 } },
            failed: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, time: '$_id', failed: 1 } },
      ),
    );
    expect(frame.fields).toEqual([
      { name: 'failed', type: 'number' },
      { name: 'time', type: 'time' },
    ]);
    const [failed, times] = frame.values as [number[], number[]];
    const peak = times[failed.indexOf(Math.max(...failed))] ?? 0;
    const minutes = (peak - incident.getTime()) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(0);
    expect(minutes).toBeLessThanOrEqual(30);
  });

  test('flattens nested documents and types BSON values', async () => {
    const frame = await frameOf(
      mongodb(
        'orders',
        { $limit: 3 },
        { $project: { _id: 1, total: 1, customer: 1, items: 1, created_at: 1 } },
      ),
    );
    expect(Object.fromEntries(frame.fields.map((field) => [field.name, field.type]))).toEqual({
      _id: 'string',
      total: 'number',
      'customer.country': 'string',
      'customer.returning': 'boolean',
      items: 'string',
      created_at: 'time',
    });
    expect(frame.values[0]?.[0]).toMatch(/^[0-9a-f]{24}$/);
  });

  test('stops at the row limit', async () => {
    const [frame] = await reader.execute(mongodb('orders'), context({ maxRows: 10 }));
    expect(frame?.meta).toMatchObject({ rowCount: 10, truncated: true });
  });

  test('refuses stages that write and JavaScript, even with a user that could run them', async () => {
    for (const query of [
      mongodb('orders', { $out: 'copy' }),
      mongodb('orders', { $match: { $where: 'true' } }),
    ]) {
      const failure = await owner.execute(query, context()).then(
        () => undefined,
        (error: unknown) => error as ConnectorError,
      );
      expect(failure).toMatchObject({ code: 'rejected' });
    }
  });

  test('describes collections and views with the fields of sampled documents', async () => {
    const snapshot = await reader.describe(AbortSignal.timeout(10_000));
    const byName = Object.fromEntries(snapshot.entities.map((entity) => [entity.name, entity]));
    expect(Object.keys(byName)).toEqual(['deploys', 'failed_orders', 'orders']);
    expect(byName.orders?.kind).toBe('collection');
    expect(byName.orders?.rowEstimate).toBeGreaterThan(1000);
    expect(byName.failed_orders?.kind).toBe('view');
    const fields = Object.fromEntries((byName.orders?.fields ?? []).map((f) => [f.name, f]));
    expect(fields.total).toMatchObject({ nativeType: 'decimal', type: 'number' });
    expect(fields.created_at).toMatchObject({ nativeType: 'date', type: 'time' });
    expect(fields['customer.country']).toMatchObject({ nativeType: 'string', type: 'string' });
  });

  test('samples distinct values of a field, nested ones by their dotted name', async () => {
    const signal = AbortSignal.timeout(10_000);
    const statuses = await reader.sampleValues({ entity: 'orders', field: 'status' }, 10, signal);
    expect([...statuses.values].sort()).toEqual(['failed', 'paid']);
    const countries = await reader.sampleValues(
      { entity: 'orders', field: 'customer.country' },
      10,
      signal,
    );
    expect(countries).toMatchObject({ complete: true });
    expect(countries.values).toHaveLength(6);
  });
});
