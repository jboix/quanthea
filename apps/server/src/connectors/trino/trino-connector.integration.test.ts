import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import {
  ConnectorError,
  type ConnectorInstance,
  type ExecutionContext,
  type SqlParameter,
} from '../_shared/index.ts';
import { devIncidentStart, devTrino, integrationFor } from '../_shared/test/dev-sources.ts';
import { trinoConnector } from './trino-connector.ts';

const live = integrationFor('trino');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 60 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/** A statement that runs for minutes. */
const slowQuery = 'SELECT count(*) FROM orders a CROSS JOIN orders b WHERE a.id + b.id = 7';

/**
 * An execution context over the incident hour.
 *
 * @param overrides - Fields to replace.
 * @returns The context.
 */
function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    refId: 'A',
    signal: AbortSignal.timeout(20_000),
    timeoutMs: 20_000,
    maxRows: 1000,
    timeRange,
    ...overrides,
  };
}

/**
 * Runs SQL and returns its first frame.
 *
 * @param connection - The connection.
 * @param text - The statement.
 * @param parameters - The values of its placeholders.
 * @param overrides - Context fields to replace.
 * @returns The frame.
 */
async function frameOf(
  connection: ConnectorInstance,
  text: string,
  parameters: SqlParameter[] = [],
  overrides: Partial<ExecutionContext> = {},
) {
  const [frame] = await connection.execute(
    { language: 'sql', text, parameters },
    context(overrides),
  );
  if (!frame) throw new Error('No frame.');
  return frame;
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
  return frameOf(connection, text, [], overrides)
    .then(() => undefined)
    .catch((error: unknown) => error as ConnectorError);
}

testConnectorConformance(trinoConnector, {
  config: devTrino.config,
  secret: devTrino.secret,
  query: {
    language: 'sql',
    text: 'SELECT created_at, status, total_cents FROM orders WHERE created_at BETWEEN ? AND ? ORDER BY created_at',
    parameters: [timeRange.from, timeRange.to],
  },
  invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
  sampleField: { entity: 'orders', field: 'status' },
  timeRange,
  live,
});

describe.skipIf(!live)('trino connector against the dev Trino', () => {
  let reader: ConnectorInstance;

  beforeAll(() => {
    reader = trinoConnector.open({
      config: trinoConnector.configSchema.parse(devTrino.config),
      secret: trinoConnector.secretSchema.parse(devTrino.secret),
    });
  });

  afterAll(() => reader.close());

  test('names the server and the user, and cannot say whether the user could write', async () => {
    const health = await reader.test(AbortSignal.timeout(20_000));
    expect(health).toMatchObject({ ok: true, readOnly: null });
    expect(health.message).toMatch(/^Trino \d+\. User dash_ro; every query runs in a read-only/);
  });

  test('refuses writes through a catalog that could make them', async () => {
    for (const text of [
      "INSERT INTO deploys (id, service, version, deployed_at, author) VALUES (9999, 'x', 'x', now(), 'x')",
      'CREATE TABLE sneaky (a integer)',
      'DELETE FROM deploys WHERE id = 1',
    ]) {
      expect(await failureOf(reader, text)).toMatchObject({ code: 'rejected' });
    }
    const count = await frameOf(reader, 'SELECT count(*) AS n FROM deploys');
    expect(count.values[0]).toEqual([484]);
  });

  test('cancels a statement when the caller gives up, and at the timeout on the server', async () => {
    const started = performance.now();
    const cancelled = await failureOf(reader, slowQuery, { signal: AbortSignal.timeout(500) });
    expect(cancelled?.code).toBe('timeout');
    expect(performance.now() - started).toBeLessThan(5000);
    const timedOut = await failureOf(reader, slowQuery, { timeoutMs: 1000 });
    expect(timedOut).toMatchObject({ code: 'timeout' });
    expect(timedOut?.message).toContain('EXCEEDED_TIME_LIMIT');
    await Bun.sleep(1000);
    const running = await frameOf(
      reader,
      "SELECT count(*) AS n FROM system.runtime.queries WHERE state = 'RUNNING' AND query LIKE '%a.id + b.id = 7%' AND query NOT LIKE '%system.runtime%'",
    );
    expect(running.values[0]).toEqual([0]);
  });

  test('stops at the row limit even when the query asks for more, and cancels the rest', async () => {
    const frame = await frameOf(reader, 'SELECT id FROM orders ORDER BY id', [], { maxRows: 10 });
    expect(frame.meta).toMatchObject({ rowCount: 10, truncated: true });
    expect(frame.values[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('types decimals, times in any zone and booleans, and binds values as literals', async () => {
    const typed = await frameOf(
      reader,
      "SELECT CAST(2.5 AS decimal(4, 2)) AS n, TIMESTAMP '2026-09-27 12:02:00 Europe/Zurich' AS zoned, TIMESTAMP '2026-09-27 12:02:00' AS plain, DATE '2026-09-27' AS day, true AS yes, nan() AS nothing, ? AS bound, ? AS at",
      ["it's a \\ 'quote'", new Date('2026-09-27T12:02:00.5Z')],
    );
    expect(typed.fields.map((field) => field.type)).toEqual([
      'number',
      'time',
      'time',
      'time',
      'boolean',
      'number',
      'string',
      'time',
    ]);
    expect(typed.values.map((column) => column[0])).toEqual([
      2.5,
      Date.UTC(2026, 8, 27, 10, 2),
      Date.UTC(2026, 8, 27, 12, 2),
      Date.UTC(2026, 8, 27),
      true,
      null,
      "it's a \\ 'quote'",
      Date.UTC(2026, 8, 27, 12, 2, 0, 500),
    ]);
    const empty = await frameOf(reader, 'SELECT id, status FROM orders WHERE 1 = 0');
    expect(empty.fields.map((field) => field.name)).toEqual(['id', 'status']);
    expect(empty.meta.rowCount).toBe(0);
  });

  test('names a missing table or column, and nothing else of the message', async () => {
    expect(await failureOf(reader, 'SELECT * FROM nope')).toMatchObject({
      code: 'not_found',
      safeMessage: 'Table "orders.public.nope" does not exist.',
    });
    expect(await failureOf(reader, 'SELECT nope FROM orders')).toMatchObject({
      code: 'not_found',
      safeMessage: 'Column "nope" does not exist.',
    });
    expect(await failureOf(reader, "SELECT CAST('secret' AS integer)")).toMatchObject({
      code: 'syntax',
      safeMessage: 'An argument or value has the wrong type or format.',
    });
  });

  test('describes the tables with their comments', async () => {
    const snapshot = await reader.describe(AbortSignal.timeout(20_000));
    const orders = snapshot.entities.find((entity) => entity.name === 'orders');
    expect(orders?.description).toBe(
      'One row per order attempt, including failed ones. total_cents is in centimes: divide by 100 for CHF.',
    );
    expect(orders?.fields.find((field) => field.name === 'created_at')).toMatchObject({
      type: 'time',
      nativeType: 'timestamp(6) with time zone',
    });
    expect(orders?.fields.find((field) => field.name === 'total_cents')?.type).toBe('number');
  });

  test('samples only columns that exist, whatever the field name says', async () => {
    const sample = await reader.sampleValues(
      { entity: 'orders', field: 'status' },
      10,
      AbortSignal.timeout(20_000),
    );
    expect([...sample.values].sort()).toEqual(['failed', 'paid', 'refunded']);
    expect(sample.complete).toBe(true);
    const injected = await reader
      .sampleValues(
        { entity: 'orders', field: 'status"; DROP TABLE orders; --' },
        10,
        AbortSignal.timeout(20_000),
      )
      .catch((error: unknown) => error as ConnectorError);
    expect(injected).toBeInstanceOf(ConnectorError);
    expect(injected).toMatchObject({ code: 'not_found' });
  });
});
