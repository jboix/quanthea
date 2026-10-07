import { describe, expect, test } from 'bun:test';
import type { Pool } from 'mysql2';
import { withSession } from './session.ts';

/** The callback a fake connection answers a statement with. */
type Answer = (error: Error | null, rows: unknown[]) => void;

/**
 * A pool of one fake connection whose server runs with a given `sql_mode`, recording every
 * statement it is sent.
 *
 * @param serverMode - The session's `sql_mode` before quanthea pins it.
 * @returns The pool and the statements sent so far.
 */
function fakePool(serverMode: string): { pool: Pool; statements: string[] } {
  const statements: string[] = [];
  const connection = {
    threadId: 7,
    execute: (sql: string, _values: unknown[], answer: Answer) => {
      statements.push(sql);
      answer(null, sql.includes('@@SESSION.sql_mode') ? [{ mode: serverMode }] : []);
    },
    release: () => undefined,
    destroy: () => undefined,
  };
  const pool = {
    getConnection: (handOver: (error: Error | null, given: unknown) => void) =>
      handOver(null, connection),
  };
  return { pool: pool as unknown as Pool, statements };
}

describe('withSession', () => {
  test('pins the sql_mode without ANSI_QUOTES and NO_BACKSLASH_ESCAPES before the work', async () => {
    const { pool, statements } = fakePool('ANSI_QUOTES,NO_BACKSLASH_ESCAPES,STRICT_TRANS_TABLES');
    const seen = await withSession(pool, 100, new AbortController().signal, async () => [
      ...statements,
    ]);
    expect(seen).toContain("SET SESSION sql_mode = 'STRICT_TRANS_TABLES'");
    expect(seen).toContain('SET SESSION TRANSACTION READ ONLY');
  });

  test('pins the mode once per connection', async () => {
    const { pool, statements } = fakePool('ANSI_QUOTES');
    const signal = new AbortController().signal;
    await withSession(pool, 100, signal, async () => undefined);
    await withSession(pool, 100, signal, async () => undefined);
    expect(statements.filter((sql) => sql.startsWith('SET SESSION sql_mode'))).toEqual([
      "SET SESSION sql_mode = ''",
    ]);
  });
});
