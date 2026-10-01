import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@querent/plugin-kit/testing';
import type {
  ConnectorError,
  ConnectorInstance,
  ExecutionContext,
  HttpQuery,
} from '../_shared/index.ts';
import { devHttpApi, devIncidentStart, integrationFor } from '../_shared/test/dev-sources.ts';
import { httpConnector } from './http-connector.ts';

const live = integrationFor('http');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/**
 * A bound GET request.
 *
 * @param path - The path.
 * @param query - The parameters.
 * @param extract - Where the rows are, and the columns.
 * @returns The query.
 */
function get(
  path: string,
  query: [string, string][] = [],
  extract: HttpQuery['extract'] = { rows: '' },
): HttpQuery {
  return { language: 'http', method: 'GET', path, query, extract };
}

/** The incident range as query parameters. */
const range: [string, string][] = [
  ['from', timeRange.from.toISOString()],
  ['to', timeRange.to.toISOString()],
];

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
 * Opens the dev API with settings changed.
 *
 * @param config - Settings to replace.
 * @param secret - Credentials to replace.
 * @returns The connection.
 */
function open(config: Record<string, unknown> = {}, secret: Record<string, unknown> = {}) {
  return httpConnector.open({
    config: httpConnector.configSchema.parse({ ...devHttpApi.config, ...config }),
    secret: httpConnector.secretSchema.parse({ ...devHttpApi.secret, ...secret }),
  });
}

/**
 * Runs a request and returns what it rejected with.
 *
 * @param connection - The connection.
 * @param query - The request.
 * @returns The connector error, or `undefined` when it succeeded.
 */
function failureOf(connection: ConnectorInstance, query: HttpQuery) {
  return connection.execute(query, context()).then(
    () => undefined,
    (error: unknown) => error as ConnectorError,
  );
}

testConnectorConformance(httpConnector, {
  config: devHttpApi.config,
  secret: devHttpApi.secret,
  query: get('/api/v1/deploys', [], { rows: '/data' }),
  invalidQuery: get('/api/v1/nope'),
  sampleField: { entity: 'GET /api/v1/deploys', field: 'service' },
  timeRange,
  live,
});

describe.skipIf(!live)('http connector against the dev API', () => {
  let connection: ConnectorInstance;

  beforeAll(() => {
    connection = open();
  });

  afterAll(() => connection.close());

  test('counts the operations its description lists', async () => {
    const health = await connection.test(AbortSignal.timeout(10_000));
    expect(health).toMatchObject({
      ok: true,
      message: 'The OpenAPI description lists 5 operations the connector allows.',
    });
  });

  test('describes each operation with its parameters, where its rows are, and their fields', async () => {
    const snapshot = await connection.describe(AbortSignal.timeout(10_000));
    const deploys = snapshot.entities.find((entity) => entity.name === 'GET /api/v1/deploys');
    expect(deploys?.kind).toBe('endpoint');
    expect(deploys?.description).toStartWith(
      'Production deploys, newest last. Parameters: service',
    );
    expect(deploys?.description).toEndWith('Rows at /data.');
    expect(deploys?.fields.find((field) => field.name === 'deployed_at')).toMatchObject({
      type: 'time',
      description: 'When it went live.',
    });
    const status = snapshot.entities.find((entity) => entity.name === 'GET /api/v1/status');
    expect(status?.fields.map((field) => field.name)).toContain('checks.database.ok');
    expect(snapshot.entities.map((entity) => entity.name)).toContain('POST /api/v1/errors/search');
  });

  test('turns nested rows into typed columns, and repeats a parameter for several values', async () => {
    const [frame] = await connection.execute(
      get('/api/v1/deploys', [...range, ['service', 'checkout-svc'], ['service', 'payments-svc']], {
        rows: '/data',
      }),
      context(),
    );
    expect(frame?.fields).toEqual([
      { name: 'id', type: 'number' },
      { name: 'service', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'deployed_at', type: 'time' },
      { name: 'author', type: 'string' },
    ]);
    expect(frame?.values[0]).toEqual([481, 482]);
    expect(frame?.values[3]?.[0]).toBe(incident.getTime());
  });

  test('reads named fields, times in epoch seconds included, and finds the incident', async () => {
    const [frame] = await connection.execute(
      get('/api/v1/services/checkout-svc/errors', [...range, ['step', '60']], {
        rows: '/points',
        fields: [
          { name: 'time', pointer: '/t', type: 'time', unit: 's' },
          { name: 'errors', pointer: '/errors' },
        ],
      }),
      context(),
    );
    const [times, errors] = (frame?.values ?? [[], []]) as [number[], number[]];
    const peak = times[errors.indexOf(Math.max(...errors))] ?? 0;
    const minutes = (peak - incident.getTime()) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(10);
    expect(minutes).toBeLessThanOrEqual(20);
  });

  test('sends a POST body, and reads one object as one row with dotted columns', async () => {
    const [search] = await connection.execute(
      {
        language: 'http',
        method: 'POST',
        path: '/api/v1/errors/search',
        query: [],
        body: { services: ['checkout-svc'], from: range[0]?.[1], to: range[1]?.[1] },
        extract: { rows: '/results' },
      },
      context(),
    );
    expect(search?.values[0]).toEqual(['checkout-svc']);
    expect(Number(search?.values[2]?.[0])).toBeGreaterThan(100);
    const [status] = await connection.execute(get('/api/v1/status'), context());
    expect(status?.meta.rowCount).toBe(1);
    const columns = Object.fromEntries(
      (status?.fields ?? []).map((field) => [field.name, field.type]),
    );
    expect(columns).toMatchObject({
      version: 'string',
      'checks.database.ok': 'boolean',
      'checks.queue.depth': 'number',
    });
  });

  test('stops at the row limit', async () => {
    const [frame] = await connection.execute(
      get('/api/v1/deploys', [], { rows: '/data' }),
      context({ maxRows: 10 }),
    );
    expect(frame?.meta).toMatchObject({ rowCount: 10, truncated: true });
  });

  test('refuses what its settings do not allow, and says what the API refused', async () => {
    expect(
      await failureOf(open({ methods: 'GET' }), {
        ...get('/api/v1/errors/search'),
        method: 'POST',
        body: {},
      }),
    ).toMatchObject({
      code: 'rejected',
    });
    expect(await failureOf(connection, get('/openapi.json'))).toMatchObject({
      code: 'rejected',
      safeMessage: 'The path is not one this connector allows.',
    });
    expect(await failureOf(open({}, { token: 'wrong' }), get('/api/v1/services'))).toMatchObject({
      code: 'authentication',
    });
    expect(
      await failureOf(connection, get('/api/v1/services', [], { rows: '/nope' })),
    ).toMatchObject({
      code: 'rejected',
    });
  });

  test('samples the values the description lists, and nothing else', async () => {
    const tiers = await connection.sampleValues(
      { entity: 'GET /api/v1/services', field: 'tier' },
      10,
      AbortSignal.timeout(10_000),
    );
    expect(tiers).toEqual({ values: ['critical', 'standard'], complete: true });
    const none = await connection
      .sampleValues(
        { entity: 'GET /api/v1/services', field: 'name' },
        10,
        AbortSignal.timeout(10_000),
      )
      .catch((error: unknown) => error as ConnectorError);
    expect(none).toMatchObject({ code: 'not_found' });
  });
});
