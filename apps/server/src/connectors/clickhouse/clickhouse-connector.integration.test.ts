import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import {
  ConnectorError,
  type ConnectorInstance,
  type ExecutionContext,
  type SqlParameter,
} from '../_shared/index.ts';
import { devClickhouseAs, devIncidentStart, integrationFor } from '../_shared/test/dev-sources.ts';
import { clickhouseConnector } from './clickhouse-connector.ts';

const live = integrationFor('clickhouse');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 60 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/** A statement that runs for minutes without reading more rows from the table. */
const slowQuery =
  'SELECT count() FROM orders ARRAY JOIN range(1000) AS x ARRAY JOIN range(1000) AS y WHERE cityHash64(id, x, y) % 7 = 3';

/**
 * Opens the dev ClickHouse as a user.
 *
 * @param username - The user.
 * @returns The connection.
 */
function open(username: string): ConnectorInstance {
  const source = devClickhouseAs(username);
  return clickhouseConnector.open({
    config: clickhouseConnector.configSchema.parse(source.config),
    secret: clickhouseConnector.secretSchema.parse(source.secret),
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

for (const username of ['dash_ro', 'dash_ro_2']) {
  const source = devClickhouseAs(username);
  testConnectorConformance(clickhouseConnector, {
    config: source.config,
    secret: source.secret,
    query: {
      language: 'sql',
      text: "SELECT created_at, status, total FROM orders WHERE created_at BETWEEN {p1:DateTime64(3, 'UTC')} AND {p2:DateTime64(3, 'UTC')} ORDER BY created_at",
      parameters: [timeRange.from, timeRange.to],
    },
    invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
    sampleField: { entity: 'orders', field: 'status' },
    timeRange,
    live,
    label: username,
  });
}

describe.skipIf(!live)('clickhouse connector against the dev ClickHouse', () => {
  let reader: ConnectorInstance;
  let readonlyTwo: ConnectorInstance;
  let owner: ConnectorInstance;

  beforeAll(() => {
    reader = open('dash_ro');
    readonlyTwo = open('dash_ro_2');
    owner = open('quanthea_admin');
  });

  afterAll(async () => {
    await Promise.all([reader.close(), readonlyTwo.close(), owner.close()]);
  });

  test('names the server and says whether the user can write', async () => {
    const signal = AbortSignal.timeout(10_000);
    const readerHealth = await reader.test(signal);
    expect(readerHealth).toMatchObject({ ok: true, readOnly: true });
    expect(readerHealth.message).toMatch(
      /^ClickHouse \d+\.\d+.*\. User dash_ro has no write grants\.$/,
    );
    expect((await readonlyTwo.test(signal)).message).toEndWith(
      'User dash_ro_2 is read-only (readonly=2).',
    );
    expect(await owner.test(signal)).toMatchObject({ ok: true, readOnly: false });
  });

  test('fails the test of a readonly=1 user and of a wrong password, and says why', async () => {
    const signal = AbortSignal.timeout(10_000);
    const readonlyOne = open('dash_ro_1');
    const health = await readonlyOne.test(signal);
    expect(health).toMatchObject({ ok: false, readOnly: true });
    expect(health.message).toContain('readonly=1');
    expect(await failureOf(readonlyOne, 'SELECT 1')).toMatchObject({ code: 'rejected' });
    const source = devClickhouseAs('dash_ro');
    const wrong = clickhouseConnector.open({
      config: clickhouseConnector.configSchema.parse(source.config),
      secret: { password: 'wrong' },
    });
    expect(await wrong.test(signal)).toMatchObject({
      ok: false,
      message: 'The username or password was refused.',
    });
  });

  test('refuses writes, schema changes, settings and table functions with a user that could', async () => {
    for (const text of [
      "INSERT INTO deploys VALUES (9999, 'x', 'x', now(), 'x')",
      'CREATE TABLE sneaky (a Int8) ENGINE = Memory',
      'DROP VIEW failed_orders',
      'SELECT 1 SETTINGS max_result_rows = 0',
      "SELECT * FROM url('http://127.0.0.1:8123/ping', 'LineAsString')",
    ]) {
      expect(await failureOf(owner, text)).toMatchObject({ code: 'rejected' });
    }
    expect(
      await failureOf(readonlyTwo, "INSERT INTO deploys VALUES (9999, 'x', 'x', now(), 'x')"),
    ).toBeInstanceOf(ConnectorError);
    const count = await frameOf(owner, 'SELECT count() AS n FROM deploys');
    expect(count.values[0]).toEqual([484]);
  });

  test('gives up when the caller does, and the server stops the statement at the timeout', async () => {
    const started = performance.now();
    const cancelled = await failureOf(reader, slowQuery, {
      signal: AbortSignal.timeout(300),
      timeoutMs: 1000,
    });
    expect(cancelled?.code).toBe('timeout');
    expect(performance.now() - started).toBeLessThan(1000);
    const timedOut = await failureOf(reader, slowQuery, { timeoutMs: 300 });
    expect(timedOut).toMatchObject({ code: 'timeout' });
    expect(timedOut?.message).toContain('TIMEOUT_EXCEEDED');
    await Bun.sleep(1000);
    const running = await frameOf(
      owner,
      "SELECT count() AS n FROM system.processes WHERE user = 'dash_ro'",
    );
    expect(running.values[0]).toEqual([0]);
  });

  test('stops at the row limit even when the query asks for more', async () => {
    const frame = await frameOf(reader, 'SELECT id FROM orders ORDER BY id LIMIT 500', [], {
      maxRows: 10,
    });
    expect(frame.meta).toMatchObject({ rowCount: 10, truncated: true });
    expect(frame.values[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('types decimals, integers, UTC times and booleans, and keeps fields when empty', async () => {
    const typed = await frameOf(
      reader,
      "SELECT toDecimal64(2.5, 2) AS n, toUInt64(10) AS big, toDateTime('2026-09-27 12:02:00', 'Europe/Zurich') AS at, true AS yes, CAST(NULL, 'Nullable(Float64)') AS nothing, {p1:String} AS bound",
      ["a\\b\tc'd\n\\N"],
    );
    expect(typed.fields.map((field) => field.type)).toEqual([
      'number',
      'number',
      'time',
      'boolean',
      'number',
      'string',
    ]);
    expect(typed.values.map((column) => column[0])).toEqual([
      2.5,
      10,
      Date.UTC(2026, 8, 27, 10, 2),
      true,
      null,
      "a\\b\tc'd\n\\N",
    ]);
    const empty = await frameOf(reader, 'SELECT id, status FROM orders WHERE 1 = 0');
    expect(empty.fields.map((field) => field.name)).toEqual(['id', 'status']);
    expect(empty.meta.rowCount).toBe(0);
  });

  test('names a missing table or column, and refuses a FORMAT clause', async () => {
    expect(await failureOf(reader, 'SELECT * FROM nope')).toMatchObject({
      code: 'not_found',
      safeMessage: 'Table "nope" does not exist.',
    });
    expect(await failureOf(reader, 'SELECT nope FROM orders')).toMatchObject({
      code: 'not_found',
      safeMessage: 'Column "nope" does not exist.',
    });
    expect(await failureOf(reader, 'SELECT 1 FORMAT CSV')).toMatchObject({ code: 'rejected' });
  });

  test('describes the tables and views with their comments and row counts', async () => {
    const snapshot = await reader.describe(AbortSignal.timeout(10_000));
    const orders = snapshot.entities.find((entity) => entity.name === 'orders');
    expect(orders?.description).toBe('One row per order attempt, including failed ones.');
    expect(orders?.rowEstimate).toBeGreaterThan(10_000);
    const total = orders?.fields.find((field) => field.name === 'total');
    expect(total).toMatchObject({ type: 'number', description: 'The total in francs.' });
    expect(orders?.fields.find((field) => field.name === 'created_at')?.type).toBe('time');
    const view = snapshot.entities.find((entity) => entity.name === 'failed_orders');
    expect(view?.kind).toBe('view');
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
        { entity: 'orders', field: 'status`; DROP TABLE orders; --' },
        10,
        AbortSignal.timeout(10_000),
      )
      .catch((error: unknown) => error as ConnectorError);
    expect(injected).toBeInstanceOf(ConnectorError);
    expect(injected).toMatchObject({ code: 'not_found' });
  });
});
