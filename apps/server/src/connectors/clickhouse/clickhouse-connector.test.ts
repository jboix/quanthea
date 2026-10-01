import { describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@quanthea/plugin-kit/testing';
import type { ConnectorError } from '../_shared/index.ts';
import { quoteIdentifier, toEntities } from './catalog.ts';
import { clickhouseConnector } from './clickhouse-connector.ts';
import { fieldTypeOf, frameValue, innerType } from './columns.ts';
import { parseServerError, toConnectorError } from './errors.ts';
import { grantsWrite } from './health.ts';
import { parameterText, readRows } from './session.ts';

testConnectorConformance(clickhouseConnector, {
  config: { url: 'http://clickhouse:8123', database: 'orders', username: 'dash_ro' },
  secret: { password: 'x' },
  query: { language: 'sql', text: 'SELECT 1', parameters: [] },
  invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
  sampleField: { entity: 'orders', field: 'status' },
  timeRange: { from: new Date(0), to: new Date(1000) },
  live: false,
});

/**
 * Lines as the HTTP client yields them.
 *
 * @param lines - The lines.
 * @returns The lines, one at a time.
 */
async function* linesOf(...lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line;
}

describe('clickhouse connector target', () => {
  test('is the origin, the database and the user, without a password', () => {
    const config = clickhouseConnector.configSchema.parse({
      url: 'https://reader:secret@clickhouse.internal:8443/',
      database: 'orders',
      username: 'dash_ro',
    });
    expect(clickhouseConnector.describeTarget?.(config)).toBe(
      'https://clickhouse.internal:8443/orders as dash_ro',
    );
  });
});

describe('clickhouse column types', () => {
  test('unwrap Nullable and LowCardinality, and map numbers, times and booleans', () => {
    expect(innerType('LowCardinality(Nullable(String))')).toBe('String');
    const numbers = ['UInt8', 'Int256', 'Float32', 'Decimal(10, 2)', 'Nullable(Decimal64(3))'];
    expect(numbers.map(fieldTypeOf)).toEqual(Array(5).fill('number'));
    const times = ['Date', 'Date32', "DateTime('UTC')", "Nullable(DateTime64(3, 'UTC'))"];
    expect(times.map(fieldTypeOf)).toEqual(Array(4).fill('time'));
    expect(fieldTypeOf('Bool')).toBe('boolean');
    const strings = [
      'String',
      'UUID',
      'Array(UInt8)',
      "Enum8('a' = 1)",
      'IPv4',
      'Map(String, UInt8)',
    ];
    expect(strings.map(fieldTypeOf)).toEqual(Array(6).fill('string'));
  });

  test('turn ISO times, numbers, arrays and nulls into frame values', () => {
    expect(frameValue('time', '2026-09-27T12:02:00.500Z')).toBe(
      Date.UTC(2026, 8, 27, 12, 2, 0, 500),
    );
    expect(frameValue('time', '2026-09-27')).toBe(Date.UTC(2026, 8, 27));
    expect(frameValue('number', 2.5)).toBe(2.5);
    expect(frameValue('string', [1, 2])).toBe('[1,2]');
    expect(frameValue('boolean', true)).toBe(true);
    expect(frameValue('number', null)).toBeNull();
  });
});

describe('clickhouse parameters', () => {
  test('escape what the parameter format reads as escapes, and write null and times', () => {
    expect(parameterText('a\\b\tc\nd\re')).toBe('a\\\\b\\tc\\nd\\re');
    expect(parameterText("it's")).toBe("it's");
    expect(parameterText('\\N')).toBe('\\\\N');
    expect(parameterText(null)).toBe('\\N');
    expect(parameterText(new Date('2026-09-27T12:02:00.5Z'))).toBe('2026-09-27 12:02:00.500');
    expect(parameterText(true)).toBe('true');
  });
});

describe('clickhouse output', () => {
  test('reads names, types and rows, and stops at the row limit', async () => {
    const result = await readRows(
      linesOf('["id", "at"]', '["UInt64", "DateTime"]', '[1, "x"]', '[2, "y"]', '[3, "z"]'),
      2,
    );
    expect(result.columns).toEqual([
      { name: 'id', type: 'UInt64' },
      { name: 'at', type: 'DateTime' },
    ]);
    expect(result.rows).toEqual([
      [1, 'x'],
      [2, 'y'],
    ]);
  });

  test('keeps the columns of an empty result', async () => {
    const result = await readRows(linesOf('["id"]', '["UInt64"]'), 10);
    expect(result).toEqual({ columns: [{ name: 'id', type: 'UInt64' }], rows: [] });
  });

  test('turns an error written after the rows started into a connector error', async () => {
    const failure = await readRows(
      linesOf(
        '["n"]',
        '["UInt64"]',
        '[1]',
        '',
        '__exception__',
        'tag',
        "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero: 'secret'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.8.15.10 (official build))",
        '120 tag',
        '__exception__',
      ),
      10,
    ).catch((error: unknown) => error as ConnectorError);
    expect(failure).toMatchObject({
      code: 'internal',
      safeMessage: 'ClickHouse reported error 395 (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO).',
    });
  });

  test('refuses output in another format', async () => {
    const failure = await readRows(linesOf('n', '1'), 10).catch(
      (error: unknown) => error as ConnectorError,
    );
    expect(failure).toMatchObject({
      code: 'internal',
      safeMessage: expect.stringContaining('FORMAT'),
    });
  });
});

describe('clickhouse errors', () => {
  test('map server errors to codes with messages that quote no values', () => {
    const cases: [string, string, string][] = [
      [
        "Code: 62. DB::Exception: Syntax error: failed at position 8 ('secret')",
        'syntax',
        'syntax',
      ],
      ['Code: 516. DB::Exception: dash_ro: Authentication failed', 'authentication', 'refused'],
      ['Code: 164. DB::Exception: Cannot execute query in readonly mode', 'rejected', 'only read'],
      ['Code: 159. DB::Exception: Timeout exceeded: elapsed 1 ms', 'timeout', 'cancelled'],
      ["Code: 53. DB::Exception: Cannot convert string 'secret' to type UInt64", 'syntax', 'type'],
      ['Code: 497. DB::Exception: Not enough privileges', 'permission', 'may not'],
      ['Code: 396. DB::Exception: Limit for result exceeded', 'rejected', 'limit'],
    ];
    for (const [text, code, safe] of cases) {
      const error = toConnectorError(parseServerError(text));
      expect(error).toMatchObject({ code });
      expect(error.safeMessage).toContain(safe);
      expect(error.safeMessage).not.toContain('secret');
      expect(error.message).toBe(text);
    }
  });

  test('name a missing table, column or function, which is schema rather than data', () => {
    const missing = (text: string) => toConnectorError(parseServerError(text));
    expect(
      missing("Code: 60. DB::Exception: Unknown table expression identifier 'nope' in scope"),
    ).toMatchObject({ code: 'not_found', safeMessage: 'Table "nope" does not exist.' });
    expect(
      missing('Code: 47. DB::Exception: Unknown expression identifier `nope` in scope'),
    ).toMatchObject({ code: 'not_found', safeMessage: 'Column "nope" does not exist.' });
    expect(
      missing('Code: 46. DB::Exception: Function with name `nope` does not exist. In scope'),
    ).toMatchObject({ code: 'not_found', safeMessage: 'Function "nope" does not exist.' });
  });

  test('read the code from the header when the text has none, and the name at the end', () => {
    expect(parseServerError('boom', '241')).toMatchObject({ code: 241, name: '' });
    expect(
      parseServerError(
        'Code: 1. DB::Exception: x. (UNSUPPORTED_METHOD) (version 26.8 (official build))',
      ),
    ).toMatchObject({ code: 1, name: 'UNSUPPORTED_METHOD' });
  });
});

describe('clickhouse grants', () => {
  test('count only privileges that write, from SHOW GRANTS lines', () => {
    expect(grantsWrite('GRANT SELECT ON orders.* TO dash_ro')).toBe(false);
    expect(grantsWrite('GRANT SELECT(id, status), SHOW TABLES ON orders.t TO dash_ro')).toBe(false);
    expect(grantsWrite('GRANT SELECT, INSERT, ALTER UPDATE ON default.* TO ro2')).toBe(true);
    expect(grantsWrite('GRANT ALL ON *.* TO querent_admin WITH GRANT OPTION')).toBe(true);
    expect(grantsWrite('GRANT writer TO ro2')).toBe(false);
  });
});

describe('clickhouse catalog', () => {
  test('groups columns into tables and views, with comments and row counts', () => {
    const row = {
      table_name: 'orders',
      engine: 'MergeTree',
      table_comment: 'Orders.',
      total_rows: 12,
      column_comment: '',
    };
    const entities = toEntities([
      { ...row, column_name: 'id', column_type: 'UInt64' },
      { ...row, column_name: 'total', column_type: 'Decimal(10, 2)', column_comment: 'Francs.' },
      {
        ...row,
        table_name: 'failed',
        engine: 'View',
        table_comment: '',
        total_rows: null,
        column_name: 'id',
        column_type: 'UInt64',
      },
    ]);
    expect(entities).toEqual([
      {
        name: 'orders',
        kind: 'table',
        description: 'Orders.',
        rowEstimate: 12,
        fields: [
          { name: 'id', nativeType: 'UInt64', type: 'number' },
          { name: 'total', nativeType: 'Decimal(10, 2)', type: 'number', description: 'Francs.' },
        ],
      },
      {
        name: 'failed',
        kind: 'view',
        fields: [{ name: 'id', nativeType: 'UInt64', type: 'number' }],
      },
    ]);
  });

  test('quotes identifiers with backslash escapes', () => {
    expect(quoteIdentifier('we`ird\\name')).toBe('`we\\`ird\\\\name`');
  });
});
