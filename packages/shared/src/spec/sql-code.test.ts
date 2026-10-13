import { describe, expect, test } from 'bun:test';
import { sqlCodeOf } from './sql-code.ts';

describe('the code of a SQL statement', () => {
  test('empties strings and drops comments, and keeps quoted identifiers', () => {
    expect(sqlCodeOf("SELECT 'now()' FROM o -- now()")).toBe("SELECT '' FROM o  ");
    expect(sqlCodeOf("SELECT 'it''s', $q$now()$q$ /* now() */ FROM o")).toBe(
      "SELECT '', ''   FROM o",
    );
    expect(sqlCodeOf('SELECT "now" FROM `o`')).toBe('SELECT "now" FROM `o`');
  });

  test('reads a string, a comment or an identifier that is never closed to the end', () => {
    expect(sqlCodeOf("SELECT 1 WHERE a = 'now()")).toBe("SELECT 1 WHERE a = ''");
    expect(sqlCodeOf('SELECT 1 /* now()')).toBe('SELECT 1  ');
    expect(sqlCodeOf('SELECT 1 $q$ now()')).toBe("SELECT 1 ''");
    expect(sqlCodeOf("SELECT 'a\\")).toBe("SELECT ''");
  });

  test('reads a long text of quotes that never close in linear time', () => {
    const texts = [`'${"\\'".repeat(100_000)}`, '/*'.repeat(100_000), '$a$'.repeat(100_000)];
    const started = performance.now();
    for (const text of texts) sqlCodeOf(text);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
