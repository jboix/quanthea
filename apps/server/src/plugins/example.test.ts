/**
 * The SQLite example plugin, end to end: packed as npm would pack it, installed through the
 * command's code path into a temporary plugins directory, loaded pinned, and queried through the
 * core's binder and SQL builders. It also proves that what reaches other files from a read-only
 * SQLite connection (ATTACH, VACUUM INTO, write pragmas, load_extension) never gets past the
 * binder's statement check.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RegisteredKind } from '../connectors/_shared/index.ts';
import { connectorKinds } from '../connectors/registry.ts';
import { buildData } from '../dashboards/queries/build.ts';
import { dataSchema } from '../dashboards/queries/request.ts';
import { createLogger } from '../lib/logger.ts';
import { bindTemplate } from '../query/bind.ts';
import { type SqlFlavor, sqlFlavorOf } from '../query/sql-dialects.ts';
import { runPluginCommand } from './command.ts';
import { loadPlugins } from './load.ts';

const example = resolve(import.meta.dir, '../../../../examples/querent-plugin-sqlite');
const work = mkdtempSync(join(tmpdir(), 'querent-example-'));
const root = join(work, 'files');
const outside = join(work, 'outside.db');
const timeRange = { from: new Date('2026-09-27T00:00:00Z'), to: new Date('2026-09-28T00:00:00Z') };

let kind: RegisteredKind;
let flavor: SqlFlavor;
const lines: string[] = [];

/**
 * Writes a database of orders, in a process of its own: only db/ talks to SQLite in the server.
 *
 * @param path - Where.
 */
function seed(path: string): void {
  const script = `const { Database } = require('bun:sqlite');
const database = new Database(${JSON.stringify(path)}, { create: true });
database.run('CREATE TABLE orders (id INTEGER, status TEXT, total REAL, created_at TEXT)');
const insert = database.prepare('INSERT INTO orders VALUES (?, ?, ?, ?)');
for (let id = 1; id <= 9; id += 1)
  insert.run(id, id % 3 === 0 ? 'failed' : 'paid', id * 10, '2026-09-27T1' + id + ':00:00.000Z');
database.close();`;
  const seeded = Bun.spawnSync([process.execPath, '--eval', script]);
  if (seeded.exitCode !== 0) throw new Error(seeded.stderr.toString());
}

beforeAll(async () => {
  const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--destination', work], {
    cwd: example,
  });
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
  const [tgz] = readdirSync(work).filter((name) => name.endsWith('.tgz'));
  const environment = { QUANTHEA_DATA_DIR: join(work, 'data') };
  const io = { say: (line: string) => lines.push(line), environment, workingDir: work, fetch };
  if ((await runPluginCommand(['install', `${tgz}`], io)) !== 0) throw new Error(lines.join('\n'));
  const pin = /"(sha256:[0-9a-f]{64})"/.exec(lines.join('\n'))?.[1] ?? '';
  const kinds = await loadPlugins({
    dir: join(work, 'data', 'plugins'),
    pins: { 'querent-plugin-sqlite': pin },
    allowUnpinned: false,
    offered: connectorKinds,
    logger: createLogger('error'),
  });
  const [found] = kinds;
  if (!found) throw new Error('The example did not load.');
  kind = found;
  flavor = sqlFlavorOf(kind) ?? 'postgres';
  mkdirSync(root, { recursive: true });
  seed(join(root, 'shop.db'));
  seed(outside);
  process.env.QUANTHEA_SQLITE_ROOT = root;
});

afterAll(() => {
  delete process.env.QUANTHEA_SQLITE_ROOT;
  rmSync(work, { recursive: true, force: true });
});

/**
 * Runs a template through the binder and the plugin.
 *
 * @param sql - The template.
 * @returns The frame.
 */
async function run(sql: string) {
  const connection = kind.open({
    config: kind.configSchema.parse({ file: 'shop.db' }),
    secret: {},
  });
  const bound = bindTemplate({ language: 'sql', sql }, {}, timeRange, {
    dialect: flavor,
  });
  const context = {
    refId: 'A',
    signal: AbortSignal.timeout(2000),
    timeoutMs: 2000,
    maxRows: 100,
    timeRange,
  };
  const [frame] = await connection.execute(bound, context);
  await connection.close();
  return frame;
}

describe('the SQLite example plugin', () => {
  test('installs from its npm tarball, prints its pin, and loads pinned with its origin', () => {
    expect(lines[0]).toStartWith('Installed querent-plugin-sqlite 0.1.0 into');
    expect(lines).toContain('plugins:');
    expect(kind.kind).toBe('sqlite-file');
    expect(kind.plugin).toEqual({ name: 'querent-plugin-sqlite', version: '0.1.0' });
    expect(flavor).toEqual({ dialect: 'ansi', placeholders: '?', rowLimit: 'limit' });
  });

  test('runs the standard SQL builders on a real file', async () => {
    const context = { saved: [], dialectOf: () => flavor };
    const request = dataSchema.parse({
      kind: 'sql-breakdown',
      connector: 'shop',
      table: 'orders',
      time: 'created_at',
      by: 'status',
      measure: { fn: 'sum', column: 'total' },
    });
    const [query] = buildData(request, context).queries;
    if (!query) throw new Error('Nothing was built.');
    const bound = bindTemplate(query, {}, timeRange, { dialect: flavor });
    const connection = kind.open({ config: { file: 'shop.db' }, secret: {} });
    const execution = {
      refId: 'A',
      signal: AbortSignal.timeout(2000),
      timeoutMs: 2000,
      maxRows: 100,
      timeRange,
    };
    const [frame] = await connection.execute(bound, execution);
    expect(frame?.values).toEqual([
      ['paid', 'failed'],
      [270, 180],
    ]);
    const ratio = await run(
      "SELECT 1e0 * sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) / nullif(count(*), 0) AS value FROM orders WHERE created_at BETWEEN :__from AND :__to",
    );
    expect(ratio?.values[0]?.[0]).toBeCloseTo(1 / 3, 6);
  });

  test('never lets a query reach another file: the statement check refuses it', async () => {
    const reaching = [
      `ATTACH DATABASE '${outside}' AS other`,
      `SELECT 1; ATTACH DATABASE '${outside}' AS other`,
      `VACUUM INTO '${join(work, 'copy.db')}'`,
      'PRAGMA user_version = 5',
      "PRAGMA journal_mode = 'delete'",
      "SELECT load_extension('/tmp/nothing')",
    ];
    for (const sql of reaching)
      await expect(run(sql)).rejects.toThrow(/one statement|starts with SELECT|cannot attach/);
    expect(existsSync(join(work, 'copy.db'))).toBe(false);
    expect((await run("SELECT name FROM pragma_table_info('orders')"))?.values[0]).toEqual([
      'id',
      'status',
      'total',
      'created_at',
    ]);
  });
});
