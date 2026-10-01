import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import { ConnectorError, type ConnectorInstance, type ExecutionContext } from '../_shared/index.ts';
import { devIncidentStart, devInfluxdb, integrationFor } from '../_shared/test/dev-sources.ts';
import { influxdbConnector } from './influxdb-connector.ts';

const live = integrationFor('influxdb');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

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
 * Opens the dev InfluxDB with settings changed.
 *
 * @param config - Settings to replace.
 * @param secret - Credentials to replace.
 * @returns The connection.
 */
function open(config: Record<string, unknown> = {}, secret: Record<string, unknown> = {}) {
  return influxdbConnector.open({
    config: influxdbConnector.configSchema.parse({ ...devInfluxdb.config, ...config }),
    secret: influxdbConnector.secretSchema.parse({ ...devInfluxdb.secret, ...secret }),
  });
}

/**
 * Runs SQL and returns what it rejected with.
 *
 * @param connection - The connection.
 * @param text - The statement.
 * @param parameters - Its values.
 * @returns The connector error, or `undefined` when it succeeded.
 */
function failureOf(connection: ConnectorInstance, text: string, parameters: string[] = []) {
  return connection.execute({ language: 'sql', text, parameters }, context()).then(
    () => undefined,
    (error: unknown) => error as ConnectorError,
  );
}

testConnectorConformance(influxdbConnector, {
  config: devInfluxdb.config,
  secret: devInfluxdb.secret,
  query: {
    language: 'sql',
    text: "SELECT date_bin(INTERVAL '5 minutes', time, $p1) AS time, sum(errors) AS errors FROM http_requests WHERE time BETWEEN $p1 AND $p2 GROUP BY 1 ORDER BY 1",
    parameters: [timeRange.from, timeRange.to],
  },
  invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
  sampleField: { entity: 'http_requests', field: 'service' },
  timeRange,
  live,
});

describe.skipIf(!live)('influxdb connector against the dev InfluxDB 3', () => {
  let connection: ConnectorInstance;

  beforeAll(() => {
    connection = open();
  });

  afterAll(() => connection.close());

  test('names the server and says the connector only queries', async () => {
    const health = await connection.test(AbortSignal.timeout(10_000));
    expect(health).toMatchObject({ ok: true, readOnly: null });
    expect(health.message).toMatch(/^InfluxDB 3 Core \d+\.\d+/);
    expect(await open({ database: 'nope' }).test(AbortSignal.timeout(10_000))).toMatchObject({
      ok: false,
      message: 'The database does not exist.',
    });
    expect(await open({}, { token: 'wrong' }).test(AbortSignal.timeout(10_000))).toMatchObject({
      ok: false,
      message: 'InfluxDB refused the token.',
    });
  });

  test('types time, tags and fields from the values, with the incident in them', async () => {
    const [frame] = await connection.execute(
      {
        language: 'sql',
        text: "SELECT date_bin(INTERVAL '1 minute', time, $p1) AS time, sum(errors) AS errors FROM http_requests WHERE service = $p3 AND time BETWEEN $p1 AND $p2 GROUP BY 1 ORDER BY 1",
        parameters: [timeRange.from, timeRange.to, 'checkout-svc'],
      },
      context(),
    );
    expect(frame?.fields).toEqual([
      { name: 'time', type: 'time' },
      { name: 'errors', type: 'number' },
    ]);
    const [times, errors] = (frame?.values ?? [[], []]) as [number[], number[]];
    const peak = times[errors.indexOf(Math.max(...errors))] ?? 0;
    const minutes = (peak - incident.getTime()) / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(10);
    expect(minutes).toBeLessThanOrEqual(20);
  });

  test('stops at the row limit', async () => {
    const [frame] = await connection.execute(
      {
        language: 'sql',
        text: 'SELECT time, service FROM http_requests ORDER BY time',
        parameters: [],
      },
      context({ maxRows: 10 }),
    );
    expect(frame?.meta).toMatchObject({ rowCount: 10, truncated: true });
  });

  test('refuses writes, and names a missing table or column but no value', async () => {
    expect(
      await failureOf(connection, "INSERT INTO http_requests (time, service) VALUES (now(), 'x')"),
    ).toMatchObject({
      code: 'rejected',
    });
    expect(await failureOf(connection, 'SELECT * FROM nope')).toMatchObject({
      code: 'not_found',
      safeMessage: 'Table "nope" does not exist.',
    });
    expect(await failureOf(connection, 'SELECT nope FROM http_requests')).toMatchObject({
      code: 'not_found',
      safeMessage: 'Column "nope" does not exist.',
    });
    const cast = await failureOf(connection, 'SELECT CAST($p1 AS BIGINT) AS n', ['secret-value']);
    expect(cast).toBeInstanceOf(ConnectorError);
    expect(cast?.safeMessage).not.toContain('secret-value');
  });

  test('describes tables with their tags, fields and time', async () => {
    const snapshot = await connection.describe(AbortSignal.timeout(10_000));
    const requests = snapshot.entities.find((entity) => entity.name === 'http_requests');
    const fields = Object.fromEntries(
      (requests?.fields ?? []).map((field) => [field.name, [field.nativeType, field.type]]),
    );
    expect(fields).toMatchObject({
      service: ['tag', 'string'],
      errors: ['field (Int64)', 'number'],
      p95_ms: ['field (Float64)', 'number'],
      time: ['time', 'time'],
    });
  });

  test('samples tags that exist, whatever the field name says', async () => {
    const services = await connection.sampleValues(
      { entity: 'http_requests', field: 'service' },
      10,
      AbortSignal.timeout(10_000),
    );
    expect([...services.values].sort()).toEqual([
      'cart-svc',
      'catalog-svc',
      'checkout-svc',
      'payments-svc',
    ]);
    const injected = await connection
      .sampleValues(
        { entity: 'http_requests', field: 'service"; DROP TABLE x; --' },
        10,
        AbortSignal.timeout(10_000),
      )
      .catch((error: unknown) => error as ConnectorError);
    expect(injected).toMatchObject({ code: 'not_found' });
  });
});
