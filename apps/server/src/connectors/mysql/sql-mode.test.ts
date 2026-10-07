import { describe, expect, test } from 'bun:test';
import { pinnedSqlMode } from './sql-mode.ts';

describe('pinnedSqlMode', () => {
  test('keeps the server modes that do not change how a statement is read', () => {
    const mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
    expect(pinnedSqlMode(mode)).toBe(mode);
    expect(pinnedSqlMode('')).toBe('');
  });

  test('drops the modes that change quotes and backslashes, and the modes that imply them', () => {
    expect(pinnedSqlMode('ANSI_QUOTES,STRICT_TRANS_TABLES,NO_BACKSLASH_ESCAPES')).toBe(
      'STRICT_TRANS_TABLES',
    );
    expect(
      pinnedSqlMode(
        'REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI',
      ),
    ).toBe('REAL_AS_FLOAT,PIPES_AS_CONCAT,IGNORE_SPACE,ONLY_FULL_GROUP_BY');
    expect(pinnedSqlMode('PIPES_AS_CONCAT,ANSI_QUOTES,ORACLE,SIMULTANEOUS_ASSIGNMENT')).toBe(
      'PIPES_AS_CONCAT,SIMULTANEOUS_ASSIGNMENT',
    );
    for (const combined of ['MSSQL', 'DB2', 'POSTGRESQL', 'MAXDB', 'ansi_quotes'])
      expect(pinnedSqlMode(combined)).toBe('');
  });

  test('keeps nothing but mode names, so the mode is safe to write in a statement', () => {
    expect(pinnedSqlMode("STRICT_TRANS_TABLES,X'; DROP TABLE t; --")).toBe('STRICT_TRANS_TABLES');
  });
});
