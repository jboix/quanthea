import { describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '../_shared/test/conformance.ts';
import { toEntities } from './catalog.ts';
import { fieldTypeOf, frameValue, parseTime } from './columns.ts';
import { toConnectorError } from './errors.ts';
import { literalOf, statementText } from './session.ts';
import { trinoConnector } from './trino-connector.ts';

testConnectorConformance(trinoConnector, {
  config: { url: 'http://trino:8080', catalog: 'hive', schema: 'sales', username: 'dash_ro' },
  secret: {},
  query: { language: 'sql', text: 'SELECT 1', parameters: [] },
  invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
  sampleField: { entity: 'orders', field: 'status' },
  timeRange: { from: new Date(0), to: new Date(1000) },
  live: false,
});

describe('trino connector target', () => {
  test('is the origin, the catalog, the schema and the user, without credentials', () => {
    const config = trinoConnector.configSchema.parse({
      url: 'https://reader:secret@trino.internal:8443/',
      catalog: 'hive',
      schema: 'sales',
      username: 'dash_ro',
    });
    expect(trinoConnector.describeTarget?.(config)).toBe(
      'https://trino.internal:8443/hive/sales as dash_ro',
    );
  });
});

describe('trino values', () => {
  test('write strings with doubled quotes only, times in UTC, and other literals', () => {
    expect(literalOf("it's \\'")).toBe("'it''s \\'''");
    expect(literalOf(new Date('2026-09-27T12:02:00.5Z'))).toBe(
      "TIMESTAMP '2026-09-27 12:02:00.500 UTC'",
    );
    expect([literalOf(1.5), literalOf(true), literalOf(null)]).toEqual([
      "DOUBLE '1.5'",
      'TRUE',
      'NULL',
    ]);
  });

  test('send the statement as a string to EXECUTE IMMEDIATE when it has values', () => {
    expect(statementText('SELECT 1', [])).toBe('SELECT 1');
    expect(statementText("SELECT ? WHERE s = 'x'", ["'; DROP TABLE t; --"])).toBe(
      "EXECUTE IMMEDIATE 'SELECT ? WHERE s = ''x''' USING '''; DROP TABLE t; --'",
    );
  });
});

describe('trino column types', () => {
  test('map numbers, dates, timestamps and booleans, and the rest to strings', () => {
    const numbers = ['tinyint', 'integer', 'bigint', 'real', 'double', 'decimal(10, 2)'];
    expect(numbers.map(fieldTypeOf)).toEqual(Array(6).fill('number'));
    const times = ['date', 'timestamp(3)', 'timestamp(6) with time zone', 'timestamp'];
    expect(times.map(fieldTypeOf)).toEqual(Array(4).fill('time'));
    expect(fieldTypeOf('boolean')).toBe('boolean');
    const strings = ['varchar(16)', 'time(3)', 'json', 'uuid', 'array(integer)'];
    expect(strings.map(fieldTypeOf)).toEqual(Array(5).fill('string'));
  });

  test('read times in UTC, at an offset or in a named zone, summer and winter', () => {
    expect(parseTime('2026-09-27')).toBe(Date.UTC(2026, 8, 27));
    expect(parseTime('2026-09-27 12:02:00.123456')).toBe(Date.UTC(2026, 8, 27, 12, 2, 0, 123));
    expect(parseTime('2026-09-27 12:02:00.000 UTC')).toBe(Date.UTC(2026, 8, 27, 12, 2));
    expect(parseTime('2026-09-27 12:02:00.000 -05:30')).toBe(Date.UTC(2026, 8, 27, 17, 32));
    expect(parseTime('2026-09-27 12:02:00.000 Europe/Zurich')).toBe(Date.UTC(2026, 8, 27, 10, 2));
    expect(parseTime('2026-01-27 12:02:00.000 Europe/Zurich')).toBe(Date.UTC(2026, 0, 27, 11, 2));
    expect(parseTime('2026-09-27 12:02:00.000 Nowhere/Land')).toBeNaN();
  });

  test('turn decimals, non-finite doubles and arrays into frame values', () => {
    expect(frameValue('number', '2.50')).toBe(2.5);
    expect(frameValue('number', 'NaN')).toBeNull();
    expect(frameValue('number', 'Infinity')).toBeNull();
    expect(frameValue('string', [1, 2])).toBe('[1,2]');
    expect(frameValue('time', 'not a time')).toBeNull();
  });
});

describe('trino errors', () => {
  test('map error names to codes with messages that quote no values', () => {
    const cases: [string, string, string][] = [
      ['SYNTAX_ERROR', 'syntax', 'syntax error'],
      ['READ_ONLY_VIOLATION', 'rejected', 'only read'],
      ['PERMISSION_DENIED', 'permission', 'may not'],
      ['EXCEEDED_TIME_LIMIT', 'timeout', 'cancelled'],
      ['USER_CANCELED', 'timeout', 'cancelled'],
      ['INVALID_CAST_ARGUMENT', 'syntax', 'wrong type'],
      ['SOMETHING_NEW', 'internal', 'SOMETHING_NEW'],
    ];
    for (const [errorName, code, safe] of cases) {
      const error = toConnectorError({ errorName, message: "Cannot cast 'secret' to INT" });
      expect(error).toMatchObject({ code });
      expect(error.safeMessage).toContain(safe);
      expect(error.safeMessage).not.toContain('secret');
      expect(error.message).toContain('secret');
    }
    expect(
      toConnectorError({
        errorName: 'EXCEEDED_LOCAL_MEMORY_LIMIT',
        errorType: 'INSUFFICIENT_RESOURCES',
      }),
    ).toMatchObject({ code: 'rejected' });
  });

  test('name a missing table, column or function, which is schema rather than data', () => {
    expect(
      toConnectorError({
        errorName: 'TABLE_NOT_FOUND',
        message: "line 1:15: Table 'hive.sales.nope' does not exist",
      }),
    ).toMatchObject({ code: 'not_found', safeMessage: 'Table "hive.sales.nope" does not exist.' });
    expect(
      toConnectorError({
        errorName: 'COLUMN_NOT_FOUND',
        message: "line 1:8: Column 'nope' cannot be resolved",
      }),
    ).toMatchObject({ code: 'not_found', safeMessage: 'Column "nope" does not exist.' });
  });
});

describe('trino catalog', () => {
  test('groups columns into tables and views, with the comments a catalog keeps', () => {
    const entities = toEntities(
      [
        { table_name: 'orders', table_type: 'BASE TABLE', column_name: 'id', data_type: 'bigint' },
        { table_name: 'orders', table_type: 'BASE TABLE', column_name: 'at', data_type: 'date' },
        { table_name: 'recent', table_type: 'VIEW', column_name: 'id', data_type: 'bigint' },
      ],
      new Map([['orders', 'Orders.']]),
    );
    expect(entities).toEqual([
      {
        name: 'orders',
        kind: 'table',
        description: 'Orders.',
        fields: [
          { name: 'id', nativeType: 'bigint', type: 'number' },
          { name: 'at', nativeType: 'date', type: 'time' },
        ],
      },
      {
        name: 'recent',
        kind: 'view',
        fields: [{ name: 'id', nativeType: 'bigint', type: 'number' }],
      },
    ]);
  });
});
