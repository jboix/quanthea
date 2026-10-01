import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import { ConnectorError, type ConnectorInstance, type ExecutionContext } from '../_shared/index.ts';
import {
  devIncidentStart,
  devPostgres,
  devPostgresOwner,
  integrationEnabled,
} from '../_shared/test/dev-sources.ts';
import { postgresConnector } from './postgres-connector.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 60 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

testConnectorConformance(postgresConnector, {
  config: devPostgres.config,
  secret: devPostgres.secret,
  query: {
    language: 'sql',
    text: 'SELECT created_at, status, total_cents FROM orders WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at',
    parameters: [timeRange.from, timeRange.to],
  },
  invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
  sampleField: { entity: 'orders', field: 'status' },
  timeRange,
  live: integrationEnabled,
});

/**
 * Opens the dev Postgres with the given credentials.
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
 * An execution context over the incident hour.
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
 * Runs SQL and returns what it rejected with.
 *
 * @param connection - The connection.
 * @param text - The statement.
 * @param overrides - Context fields to replace.
 * @returns The rejection, or `undefined` when it succeeded.
 */
function failureOf(
  connection: ConnectorInstance,
  text: string,
  overrides: Partial<ExecutionContext> = {},
) {
  return connection
    .execute({ language: 'sql', text, parameters: [] }, context(overrides))
    .then(() => undefined)
    .catch((error: unknown) => error as ConnectorError);
}

describe.skipIf(!integrationEnabled)('postgres connector against the dev database', () => {
  let reader: ConnectorInstance;
  let owner: ConnectorInstance;

  beforeAll(() => {
    reader = open(devPostgres);
    owner = open(devPostgresOwner);
  });

  afterAll(async () => {
    await reader.close();
    await owner.close();
  });

  test('says whether the role can write', async () => {
    const readerHealth = await reader.test(AbortSignal.timeout(10_000));
    expect(readerHealth).toMatchObject({ ok: true, readOnly: true });
    expect(readerHealth.message).toContain('Role dash_ro has no write grants.');
    expect(await owner.test(AbortSignal.timeout(10_000))).toMatchObject({
      ok: true,
      readOnly: false,
    });
  });

  test('refuses a write even with a role that could write', async () => {
    const sequence = await failureOf(owner, "SELECT nextval('orders_id_seq')");
    expect(sequence).toBeInstanceOf(ConnectorError);
    expect(sequence?.code).toBe('rejected');
    const nested = await failureOf(
      owner,
      'WITH gone AS (DELETE FROM refunds RETURNING id) SELECT count(*) FROM gone',
    );
    expect(nested?.code).toBe('rejected');
  });

  test('stops a statement at the timeout', async () => {
    const started = performance.now();
    const failure = await failureOf(reader, 'SELECT pg_sleep(3)', { timeoutMs: 300 });
    expect(failure?.code).toBe('timeout');
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test('cancels a running statement on the server when the signal fires', async () => {
    const controller = new AbortController();
    const started = performance.now();
    setTimeout(() => controller.abort(), 200);
    const failure = await failureOf(reader, 'SELECT pg_sleep(3)', { signal: controller.signal });
    expect(failure?.code).toBe('timeout');
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test('quotes no data in the safe message of a failed query', async () => {
    const failure = await failureOf(reader, "SELECT 'secret-value-42'::int");
    expect(failure?.message).toContain('secret-value-42');
    expect(failure?.safeMessage).not.toContain('secret-value-42');
  });

  test('types numeric, bigint and timestamptz columns, and keeps fields on an empty result', async () => {
    const [typed] = await reader.execute(
      {
        language: 'sql',
        text: 'SELECT 2.5::numeric AS n, 10::bigint AS big, now() AS at',
        parameters: [],
      },
      context(),
    );
    expect(typed?.fields.map((field) => field.type)).toEqual(['number', 'number', 'time']);
    expect(typed?.values[0]).toEqual([2.5]);
    const [empty] = await reader.execute(
      { language: 'sql', text: 'SELECT id, status FROM orders WHERE false', parameters: [] },
      context(),
    );
    expect(empty?.fields.map((field) => field.name)).toEqual(['id', 'status']);
    expect(empty?.meta.rowCount).toBe(0);
  });

  test('describes the tables with their comments and estimates', async () => {
    const snapshot = await reader.describe(AbortSignal.timeout(10_000));
    const orders = snapshot.entities.find((entity) => entity.name === 'orders');
    expect(orders?.description).toBe('One row per order attempt, including failed ones.');
    expect(orders?.rowEstimate).toBeGreaterThan(50_000);
    expect(
      orders?.fields.find((field) => field.name === 'status')?.distinctEstimate,
    ).toBeLessThanOrEqual(3);
    expect(snapshot.entities.map((entity) => entity.name)).toContain('customers');
  });

  test('samples only columns that exist, whatever the field name says', async () => {
    const sample = await reader.sampleValues(
      { entity: 'orders', field: 'status' },
      10,
      AbortSignal.timeout(10_000),
    );
    expect([...sample.values].sort()).toEqual(['failed', 'paid', 'refunded']);
    expect(sample.complete).toBe(true);
    const injected = await reader
      .sampleValues(
        { entity: 'orders', field: 'status"; DROP TABLE orders; --' },
        10,
        AbortSignal.timeout(10_000),
      )
      .catch((error: unknown) => error as ConnectorError);
    expect(injected).toMatchObject({ code: 'not_found' });
  });
});
