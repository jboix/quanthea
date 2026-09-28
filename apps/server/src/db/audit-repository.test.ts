import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { createAuditRepository } from './audit-repository.ts';
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

test('appends events with an id, a time, the actor and JSON detail', () => {
  const audit = createAuditRepository(database);
  audit.append({
    actor: 'anonymous',
    action: 'connector.create',
    target: 'c1',
    detail: { kind: 'postgres' },
  });
  audit.append({ actor: 'anonymous', action: 'connector.delete' });
  const rows = database
    .query<
      {
        id: string;
        at: number;
        actor: string;
        action: string;
        target: string | null;
        detail: string | null;
      },
      []
    >('SELECT * FROM audit_log ORDER BY id')
    .all();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    actor: 'anonymous',
    action: 'connector.create',
    target: 'c1',
    detail: '{"kind":"postgres"}',
  });
  expect(rows[1]).toMatchObject({ action: 'connector.delete', target: null, detail: null });
  expect(rows[0]?.at).toBeGreaterThan(0);
});
