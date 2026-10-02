import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectorKind } from '@quanthea/plugin-kit';
import { createTestKit, testConnectorConformance } from '@quanthea/plugin-kit/testing';
import plugin, { kitVersion } from '../src/plugin.ts';

const root = mkdtempSync(join(tmpdir(), 'sqlite-root-'));
const outside = mkdtempSync(join(tmpdir(), 'sqlite-outside-'));
const timeRange = { from: new Date('2026-09-27T00:00:00Z'), to: new Date('2026-09-28T00:00:00Z') };

/**
 * Writes a small shop database.
 *
 * @param path - Where.
 */
function seed(path: string): void {
  const database = new Database(path, { create: true });
  database.run('CREATE TABLE orders (id INTEGER, status TEXT, total REAL, created_at TEXT)');
  database.run("CREATE VIEW failed_orders AS SELECT * FROM orders WHERE status = 'failed'");
  const insert = database.prepare('INSERT INTO orders VALUES (?, ?, ?, ?)');
  for (let id = 1; id <= 6; id += 1)
    insert.run(id, id % 3 === 0 ? 'failed' : 'paid', id * 10.5, `2026-09-27T1${id}:00:00.000Z`);
  database.close();
}

seed(join(root, 'shop.db'));
seed(join(outside, 'secret.db'));
mkdirSync(join(root, 'links'));
symlinkSync(join(outside, 'secret.db'), join(root, 'links', 'secret.db'));
process.env.QUANTHEA_SQLITE_ROOT = root;

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const [first] = plugin(createTestKit()).connectors;
if (!first) throw new Error('The plugin returned no kind.');
const kind: ConnectorKind = first;

test('exports the kit version it is built for', () => {
  expect(kitVersion).toBe(0);
});

testConnectorConformance(kind, {
  config: { file: 'shop.db' },
  secret: {},
  query: { language: 'sql', text: 'SELECT id, status, created_at FROM orders', parameters: [] },
  invalidQuery: { language: 'sql', text: 'SELECT nope FROM orders', parameters: [] },
  sampleField: { entity: 'orders', field: 'status' },
  timeRange,
  live: true,
});

describe('the SQLite file plugin', () => {
  /**
   * Opens a file of the root.
   *
   * @param file - The file, relative to the root.
   * @returns The connection.
   */
  function open(file: string) {
    return kind.open({ config: kind.configSchema.parse({ file }), secret: {} });
  }

  test('reads with bound values, a time range as ISO text, and types its columns', async () => {
    const [frame] = await open('shop.db').execute(
      {
        language: 'sql',
        text: 'SELECT status, count(*) AS value, max(created_at) AS last FROM orders WHERE created_at BETWEEN ? AND ? GROUP BY status ORDER BY 1 LIMIT 10',
        parameters: [timeRange.from, timeRange.to],
      },
      { refId: 'A', signal: AbortSignal.timeout(1000), timeoutMs: 1000, maxRows: 100, timeRange },
    );
    expect(frame?.fields).toEqual([
      { name: 'status', type: 'string' },
      { name: 'value', type: 'number' },
      { name: 'last', type: 'time' },
    ]);
    expect(frame?.values[1]).toEqual([2, 4]);
  });

  test('describes tables and views with their columns and types', async () => {
    const snapshot = await open('shop.db').describe(AbortSignal.timeout(1000));
    expect(snapshot.entities.map((entity) => [entity.name, entity.kind])).toEqual([
      ['failed_orders', 'view'],
      ['orders', 'table'],
    ]);
    expect(snapshot.entities[1]).toMatchObject({ rowEstimate: 6 });
  });

  test('opens nothing without a root, outside it, through .. or a link out of it', async () => {
    const problems = async (file: string) =>
      (await open(file).test(AbortSignal.timeout(1000))).message;
    expect(await problems('../secret.db')).toContain('without ..');
    expect(await problems(join(outside, 'secret.db'))).toContain(
      'relative to QUANTHEA_SQLITE_ROOT',
    );
    expect(await problems('links/secret.db')).toContain('resolves outside QUANTHEA_SQLITE_ROOT');
    expect(await problems('missing.db')).toContain('there is no file missing.db');
    delete process.env.QUANTHEA_SQLITE_ROOT;
    try {
      expect(await problems('shop.db')).toContain('QUANTHEA_SQLITE_ROOT is not set');
    } finally {
      process.env.QUANTHEA_SQLITE_ROOT = root;
    }
  });

  test('writes nothing, even when a statement gets past the core', async () => {
    const connection = open('shop.db');
    const context = {
      refId: 'A',
      signal: AbortSignal.timeout(1000),
      timeoutMs: 1000,
      maxRows: 10,
      timeRange,
    };
    for (const text of [
      'DELETE FROM orders',
      'PRAGMA user_version = 5',
      "SELECT load_extension('x')",
    ])
      await expect(
        connection.execute({ language: 'sql', text, parameters: [] }, context),
      ).rejects.toThrow();
    const [frame] = await connection.execute(
      { language: 'sql', text: 'SELECT count(*) AS n FROM orders', parameters: [] },
      context,
    );
    expect(frame?.values[0]).toEqual([6]);
  });
});
