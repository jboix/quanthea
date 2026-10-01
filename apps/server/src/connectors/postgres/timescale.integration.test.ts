import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import { ConnectorError, type ConnectorInstance, type ExecutionContext } from '../_shared/index.ts';
import {
  devIncidentStart,
  devTimescale,
  devTimescaleOwner,
  integrationFor,
} from '../_shared/test/dev-sources.ts';
import { postgresConnector } from './postgres-connector.ts';

const live = integrationFor('timescale');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/**
 * Opens the dev TimescaleDB with the given credentials.
 *
 * @param source - The configuration and secret.
 * @returns The connection.
 */
function open(source: { config: unknown; secret: unknown }): ConnectorInstance {
  return postgresConnector.open({
    config: postgresConnector.configSchema.parse(source.config),
    secret: postgresConnector.secretSchema.parse(source.secret),
  });
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

testConnectorConformance(postgresConnector, {
  config: devTimescale.config,
  secret: devTimescale.secret,
  query: {
    language: 'sql',
    text: "SELECT time_bucket(INTERVAL '5 minutes', created_at) AS time, count(*) AS value FROM order_events WHERE created_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1",
    parameters: [timeRange.from, timeRange.to],
  },
  invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
  sampleField: { entity: 'order_events', field: 'status' },
  timeRange,
  live,
  label: 'TimescaleDB',
});

describe.skipIf(!live)('postgres connector against the dev TimescaleDB', () => {
  let reader: ConnectorInstance;
  let owner: ConnectorInstance;

  beforeAll(() => {
    reader = open(devTimescale);
    owner = open(devTimescaleOwner);
  });

  afterAll(async () => {
    await reader.close();
    await owner.close();
  }, 10_000);

  test('names TimescaleDB in the connection test', async () => {
    const health = await reader.test(AbortSignal.timeout(10_000));
    expect(health).toMatchObject({ ok: true, readOnly: true });
    expect(health.message).toMatch(/^PostgreSQL [\d.]+.* with TimescaleDB \d+\.\d+/);
  });

  test('describes hypertables and continuous aggregates, and none of their chunks', async () => {
    const snapshot = await reader.describe(AbortSignal.timeout(10_000));
    const names = snapshot.entities.map((entity) => entity.name);
    expect(
      names.some((name) => name.startsWith('_timescaledb') || name.startsWith('timescaledb')),
    ).toBe(false);
    const events = snapshot.entities.find((entity) => entity.name === 'order_events');
    expect(events?.description).toBe(
      'The order attempts, as a hypertable partitioned by time. TimescaleDB hypertable on created_at.',
    );
    expect(events?.rowEstimate).toBeGreaterThan(10_000);
    const perMinute = snapshot.entities.find((entity) => entity.name === 'orders_per_minute');
    expect(perMinute).toMatchObject({
      kind: 'view',
      description: 'TimescaleDB continuous aggregate of order_events.',
    });
  });

  test('buckets with time_bucket, and fills the gaps with time_bucket_gapfill', async () => {
    const [frame] = await reader.execute(
      {
        language: 'sql',
        text: "SELECT time_bucket_gapfill(INTERVAL '1 minute', created_at) AS time, coalesce(count(*) FILTER (WHERE status = 'failed'), 0) AS failed FROM order_events WHERE created_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1",
        parameters: [timeRange.from, timeRange.to],
      },
      context(),
    );
    expect(frame?.fields.map((field) => field.type)).toEqual(['time', 'number']);
    expect(frame?.meta.rowCount).toBe(91);
  });

  test('refuses what writes through TimescaleDB, even as the owner', async () => {
    for (const text of [
      "SELECT drop_chunks('order_events', older_than => now())",
      "CALL refresh_continuous_aggregate('orders_per_minute', NULL, NULL)",
    ]) {
      const failure = await owner
        .execute({ language: 'sql', text, parameters: [] }, context())
        .then(
          () => undefined,
          (error: unknown) => error as ConnectorError,
        );
      expect(failure).toBeInstanceOf(ConnectorError);
    }
    const [count] = await owner.execute(
      { language: 'sql', text: 'SELECT count(*) AS n FROM order_events', parameters: [] },
      context(),
    );
    expect(Number(count?.values[0]?.[0])).toBeGreaterThan(10_000);
  });
});
