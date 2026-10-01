import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { kindProblems } from './checks.ts';

/** A kind that passes every check. */
const valid = {
  kind: 'sqlite-file',
  displayName: 'SQLite file',
  language: 'sql',
  dialect: 'ansi',
  placeholders: '?',
  rowLimit: 'limit',
  configSchema: z.object({ file: z.string() }),
  secretSchema: z.object({}),
  icon: { path: 'M0 0h24v24H0z', color: '#003B57' },
  queryGuide: 'SQLite (standard SQL).',
  open: () => ({}),
};

describe('kindProblems', () => {
  test('passes a kind that declares everything right, credentials optional', () => {
    expect(kindProblems(valid)).toEqual([]);
  });

  test('names each problem of a kind that was not built with defineConnector', () => {
    expect(
      kindProblems({
        ...valid,
        kind: 'My Kind',
        displayName: ' ',
        language: 'cobol',
        icon: { path: 'M0 0<script>', color: 'red' },
        open: 'not a function',
      }),
    ).toEqual([
      'kind must be lowercase letters, digits and dashes, up to 40 characters',
      'displayName must be a name',
      'language must be one of sql, promql, search, logql, http, redis, mongodb',
      'only a SQL kind declares a dialect',
      'icon must be SVG path data and a #rrggbb colour',
      'open must be a function',
    ]);
    expect(kindProblems(null)).toEqual(['a kind must be an object']);
  });

  test('takes ansi styles on ansi only, and a dialect on SQL only', () => {
    expect(kindProblems({ ...valid, dialect: 'postgres' })).toEqual([
      'placeholders is for ansi only: ?, $1, :1, @p1',
      'rowLimit is for ansi only: fetch or limit',
    ]);
    expect(kindProblems({ ...valid, placeholders: '%s' })).toEqual([
      'placeholders is for ansi only: ?, $1, :1, @p1',
    ]);
    const { dialect: _dialect, placeholders: _p, rowLimit: _r, ...noDialect } = valid;
    expect(kindProblems(noDialect)[0]).toStartWith("a SQL kind's dialect must be one of");
    expect(kindProblems({ ...valid, language: 'promql' })[0]).toBe(
      'only a SQL kind declares a dialect',
    );
  });

  test('needs Zod object schemas, a configuration with fields and no credential in it', () => {
    expect(kindProblems({ ...valid, configSchema: { type: 'object' } })).toEqual([
      "configSchema must be an object schema with fields, built with the kit's z",
    ]);
    expect(kindProblems({ ...valid, secretSchema: z.string() })).toEqual([
      "secretSchema must be an object schema, built with the kit's z",
    ]);
    const leaky = { configSchema: z.object({ host: z.string(), password: z.string() }) };
    const secret = { secretSchema: z.object({ password: z.string() }) };
    expect(kindProblems({ ...valid, ...leaky, ...secret })).toEqual([
      'credentials in configSchema: password',
    ]);
  });

  test('keeps the guide the agent reads to 8 KB', () => {
    expect(kindProblems({ ...valid, queryGuide: 'x'.repeat(8193) })).toEqual([
      'queryGuide must be text of at most 8192 characters',
    ]);
  });
});
