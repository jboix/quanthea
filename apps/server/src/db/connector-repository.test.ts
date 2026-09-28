import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { type ConnectorRow, createConnectorRepository } from './connector-repository.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

const orders: ConnectorRow = {
  id: '01K0000000000000000000000A',
  name: 'postgres-orders',
  kind: 'postgres',
  config: { host: 'localhost', port: 5433 },
  secret: new Uint8Array([1, 2, 3]),
  accessLevel: 2,
  hiddenFields: ['customers.email'],
  guardrails: { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 },
  descriptions: { orders: 'One row per order attempt.' },
  createdAt: 1000,
  updatedAt: 1000,
};

describe('connector repository', () => {
  test('saves, finds by id and name, and lists by name', () => {
    const repository = createConnectorRepository(database);
    repository.save(orders);
    repository.save({ ...orders, id: '01K0000000000000000000000B', name: 'metrics' });
    expect(repository.get(orders.id)).toEqual(orders);
    expect(repository.getByName('postgres-orders')?.id).toBe(orders.id);
    expect(repository.list().map((row) => row.name)).toEqual(['metrics', 'postgres-orders']);
  });

  test('updates a connector saved again with the same id, keeping its cached schema', () => {
    const repository = createConnectorRepository(database);
    repository.save(orders);
    repository.writeSchema(orders.id, { snapshot: { entities: [] }, readAt: 5 });
    repository.save({ ...orders, accessLevel: 1, updatedAt: 2000 });
    expect(repository.get(orders.id)).toMatchObject({
      accessLevel: 1,
      updatedAt: 2000,
      createdAt: 1000,
    });
    expect(repository.list()).toHaveLength(1);
    expect(repository.readSchema(orders.id)).toBeDefined();
  });

  test('refuses two connectors with one name', () => {
    const repository = createConnectorRepository(database);
    repository.save(orders);
    expect(() => repository.save({ ...orders, id: '01K0000000000000000000000B' })).toThrow(
      'UNIQUE',
    );
  });

  test('deletes a connector with its cached schema', () => {
    const repository = createConnectorRepository(database);
    repository.save(orders);
    repository.writeSchema(orders.id, { snapshot: { entities: [] }, readAt: 5 });
    expect(repository.readSchema(orders.id)).toEqual({ snapshot: { entities: [] }, readAt: 5 });
    expect(repository.remove(orders.id)).toBe(true);
    expect(repository.remove(orders.id)).toBe(false);
    expect(repository.readSchema(orders.id)).toBeUndefined();
  });

  test('refuses a stored row whose guardrails no longer validate', () => {
    const repository = createConnectorRepository(database);
    repository.save(orders);
    database.run('UPDATE connectors SET guardrails = \'{"timeoutMs": 1}\'');
    expect(() => repository.get(orders.id)).toThrow();
  });
});
