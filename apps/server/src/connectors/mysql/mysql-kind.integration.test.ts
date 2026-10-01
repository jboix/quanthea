import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  type AnyConnectorKind,
  ConnectorError,
  type ConnectorInstance,
  type ExecutionContext,
} from '../_shared/index.ts';
import { testConnectorConformance } from '../_shared/test/conformance.ts';
import { devIncidentStart, devMysqlServers, integrationFor } from '../_shared/test/dev-sources.ts';
import { mariadbConnector } from './mariadb-connector.ts';
import { mysqlConnector } from './mysql-connector.ts';

const live = integrationFor('mysql');
const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 60 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};

/**
 * The kind of a dev server.
 *
 * @param name - `MySQL` or `MariaDB`.
 * @returns Its connector kind.
 */
function kindOf(name: string): AnyConnectorKind {
  return name === 'MariaDB' ? mariadbConnector : mysqlConnector;
}

/**
 * Opens a dev server with the given credentials, as a kind.
 *
 * @param kind - The connector kind.
 * @param source - The configuration and secret.
 * @returns The connection.
 */
function open(
  kind: AnyConnectorKind,
  source: { config: unknown; secret: unknown },
): ConnectorInstance {
  return kind.open({
    config: kind.configSchema.parse(source.config),
    secret: kind.secretSchema.parse(source.secret),
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

for (const server of devMysqlServers) {
  const kind = kindOf(server.name);
  testConnectorConformance(kind, {
    config: server.reader.config,
    secret: server.reader.secret,
    query: {
      language: 'sql',
      text: 'SELECT created_at, status, total FROM orders WHERE created_at BETWEEN ? AND ? ORDER BY created_at',
      parameters: [timeRange.from, timeRange.to],
    },
    invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
    sampleField: { entity: 'orders', field: 'status' },
    timeRange,
    live,
    label: server.name,
  });

  describe.skipIf(!live)(`${kind.kind} connector against the dev ${server.name}`, () => {
    let reader: ConnectorInstance;
    let owner: ConnectorInstance;

    beforeAll(() => {
      reader = open(kind, server.reader);
      owner = open(kind, server.owner);
    });

    afterAll(async () => {
      await reader.close();
      await owner.close();
    });

    test('names the server and says whether the user can write', async () => {
      const readerHealth = await reader.test(AbortSignal.timeout(10_000));
      expect(readerHealth).toMatchObject({ ok: true, readOnly: true });
      expect(readerHealth.message).toStartWith(`${server.name} `);
      expect(readerHealth.message).toContain('User dash_ro@% has no write grants.');
      expect(await owner.test(AbortSignal.timeout(10_000))).toMatchObject({
        ok: true,
        readOnly: false,
      });
    });

    test('fails the test of the other product, and names its kind', async () => {
      const other = open(kindOf(server.name === 'MariaDB' ? 'MySQL' : 'MariaDB'), server.reader);
      const health = await other.test(AbortSignal.timeout(10_000));
      await other.close();
      expect(health.ok).toBe(false);
      expect(health.message).toEndWith(`Add it as a ${server.name} connector.`);
    });

    test('refuses writes and schema changes even with a user that could make them', async () => {
      for (const text of [
        "INSERT INTO deploys VALUES (9999, 'x', 'x', NOW(), 'x')",
        'CREATE TABLE sneaky (a int)',
        'DROP VIEW failed_orders',
      ]) {
        expect(await failureOf(owner, text)).toMatchObject({ code: 'rejected' });
      }
      const [count] = await owner.execute(
        { language: 'sql', text: 'SELECT COUNT(*) AS n FROM deploys', parameters: [] },
        context(),
      );
      expect(count?.values[0]).toEqual([484]);
    });

    test('kills a running statement on the server when the signal fires', async () => {
      const started = performance.now();
      const slow = 'SELECT SUM(a.id * b.id) FROM orders a, orders b';
      const failure = await failureOf(reader, slow, {
        signal: AbortSignal.timeout(300),
      });
      expect(failure?.code).toBe('timeout');
      expect(performance.now() - started).toBeLessThan(3000);
      const [after] = await reader.execute(
        { language: 'sql', text: 'SELECT 1 AS ok', parameters: [] },
        context(),
      );
      expect(after?.values[0]).toEqual([1]);
    });

    test('stops at the row limit even when the query asks for more', async () => {
      const [frame] = await reader.execute(
        { language: 'sql', text: 'SELECT id FROM orders ORDER BY id LIMIT 500', parameters: [] },
        context({ maxRows: 10 }),
      );
      expect(frame?.meta).toMatchObject({ rowCount: 10, truncated: true });
      expect(frame?.values[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    test('types decimal, bigint and datetime columns in UTC, and keeps fields when empty', async () => {
      const [typed] = await reader.execute(
        {
          language: 'sql',
          text: "SELECT CAST(2.5 AS DECIMAL(4, 2)) AS n, CAST(10 AS SIGNED) AS big, TIMESTAMP('2026-09-27 12:02:00') AS at, ? AS bound",
          parameters: ['x'],
        },
        context(),
      );
      expect(typed?.fields.map((field) => field.type)).toEqual([
        'number',
        'number',
        'time',
        'string',
      ]);
      expect(typed?.values.map((column) => column[0])).toEqual([
        2.5,
        10,
        Date.UTC(2026, 8, 27, 12, 2),
        'x',
      ]);
      const [empty] = await reader.execute(
        { language: 'sql', text: 'SELECT id, status FROM orders WHERE 1 = 0', parameters: [] },
        context(),
      );
      expect(empty?.fields.map((field) => field.name)).toEqual(['id', 'status']);
      expect(empty?.meta.rowCount).toBe(0);
    });

    test('names a missing table or column, and nothing else of the message', async () => {
      expect(await failureOf(reader, 'SELECT * FROM nope')).toMatchObject({
        code: 'not_found',
        safeMessage: 'Table "orders.nope" does not exist.',
      });
      expect(await failureOf(reader, 'SELECT nope FROM orders')).toMatchObject({
        code: 'not_found',
        safeMessage: 'Column "nope" does not exist.',
      });
    });

    test('describes the tables and views with their comments and estimates', async () => {
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
}
