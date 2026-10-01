import { describe, expect, test } from 'bun:test';
import { BSON, MongoServerError } from 'mongodb';
import type { ConnectorError, MongodbQuery } from '../_shared/index.ts';
import { testConnectorConformance } from '../_shared/test/conformance.ts';
import { fieldsOf } from './catalog.ts';
import { toConnectorError, urlOf } from './client.ts';
import { frameOf, leafOf } from './frames.ts';
import { mongodbConnector } from './mongodb-connector.ts';

testConnectorConformance(mongodbConnector, {
  config: { host: 'mongo', database: 'shop', username: 'dash_ro' },
  secret: { password: 'x' },
  query: { language: 'mongodb', collection: 'orders', pipeline: [] },
  invalidQuery: { language: 'mongodb', collection: 'orders', pipeline: [{ $bogus: {} }] },
  sampleField: { entity: 'orders', field: 'status' },
  timeRange: { from: new Date(0), to: new Date(1000) },
  live: false,
});

const context = {
  refId: 'A',
  signal: AbortSignal.timeout(1000),
  timeoutMs: 1000,
  maxRows: 2,
  timeRange: { from: new Date(0), to: new Date(1000) },
};

/** An order as the driver gives it. */
const order = {
  _id: new BSON.ObjectId('6abe31ce077fb13726e87b97'),
  total: new BSON.Decimal128('12.50'),
  count: BSON.Long.fromNumber(3),
  created_at: new Date('2026-09-27T12:00:00Z'),
  customer: { country: 'CH', returning: true },
  items: [1, 2],
};

describe('mongodb documents as tables', () => {
  test('type BSON values: dates as times, numeric types as numbers, ObjectIds as hex', () => {
    expect(leafOf(order.total)).toEqual({ type: 'number', nativeType: 'decimal', value: 12.5 });
    expect(leafOf(order.count)).toEqual({ type: 'number', nativeType: 'long', value: 3 });
    expect(leafOf(order._id)).toMatchObject({ type: 'string', value: '6abe31ce077fb13726e87b97' });
    expect(leafOf(order.created_at)).toMatchObject({ type: 'time', value: 1790510400000 });
    expect(leafOf(new BSON.Decimal128('NaN')).value).toBeNull();
    expect(leafOf([1, 2])).toEqual({ type: 'string', nativeType: 'array', value: '[1,2]' });
  });

  test('flatten nested documents to dotted columns and stop at the row limit', () => {
    const frame = frameOf([order, order, order], context, 1);
    expect(frame.fields.map((field) => [field.name, field.type])).toEqual([
      ['_id', 'string'],
      ['total', 'number'],
      ['count', 'number'],
      ['created_at', 'time'],
      ['customer.country', 'string'],
      ['customer.returning', 'boolean'],
      ['items', 'string'],
    ]);
    expect(frame.meta).toMatchObject({ rowCount: 2, truncated: true });
  });

  test('turn a column of mixed types into text', () => {
    const frame = frameOf([{ x: 1 }, { x: 'a' }, { x: new Date(0) }], context, 1);
    expect(frame.fields).toEqual([{ name: 'x', type: 'string' }]);
    expect(frame.values[0]).toEqual(['1', 'a']);
  });

  test('list the fields of sampled documents with every BSON type they hold', () => {
    expect(fieldsOf([order, { ...order, total: null, count: 4 }]).slice(0, 3)).toEqual([
      { name: '_id', nativeType: 'objectId', type: 'string' },
      { name: 'total', nativeType: 'decimal', type: 'number' },
      { name: 'count', nativeType: 'long|double', type: 'number' },
    ]);
  });
});

describe('mongodb connections', () => {
  test('build the URL from the host, or from the DNS seed list', () => {
    const options = { host: 'mongo', port: 27017, database: 'shop', tls: 'disable' } as const;
    expect(urlOf({ ...options, srv: false })).toBe('mongodb://mongo:27017/shop');
    expect(urlOf({ ...options, host: 'cluster0.example.net', srv: true })).toBe(
      'mongodb+srv://cluster0.example.net/shop',
    );
    const config = mongodbConnector.configSchema.parse({
      host: 'mongo',
      database: 'shop',
      username: 'dash_ro',
    });
    expect(config).toMatchObject({ port: 27017, srv: false, tls: 'verify-full' });
    expect(mongodbConnector.describeTarget?.(config)).toBe('mongodb://dash_ro@mongo:27017/shop');
  });

  test('map server errors to connector errors without their text', () => {
    const server = (code: number, codeName: string) =>
      toConnectorError(new MongoServerError({ code, codeName, errmsg: 'secret value' }));
    expect(server(13, 'Unauthorized')).toMatchObject({ code: 'permission' });
    expect(server(50, 'MaxTimeMSExpired')).toMatchObject({ code: 'timeout' });
    expect(server(40324, 'Location40324')).toMatchObject({
      code: 'syntax',
      safeMessage: 'MongoDB refused the pipeline (Location40324).',
    });
    const aborted = AbortSignal.abort();
    expect(toConnectorError(new Error('x'), aborted)).toMatchObject({ code: 'timeout' });
  });

  test('refuse a stage that writes before reaching the server', async () => {
    const connection = mongodbConnector.open({
      config: mongodbConnector.configSchema.parse({ host: 'mongo', database: 'shop' }),
      secret: {},
    });
    const query: MongodbQuery = {
      language: 'mongodb',
      collection: 'orders',
      pipeline: [{ $lookup: { from: 'x', as: 'x', pipeline: [{ $merge: 'y' }] } }],
    };
    const failure = await connection.execute(query, context).then(
      () => undefined,
      (error: unknown) => error as ConnectorError,
    );
    expect(failure).toMatchObject({ code: 'rejected' });
    await connection.close();
  });
});
