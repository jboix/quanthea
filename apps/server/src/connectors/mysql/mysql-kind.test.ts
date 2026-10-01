import { describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@querent/plugin-kit/testing';
import { ConnectorError } from '../_shared/index.ts';
import { fieldTypeOf, fieldTypeOfName, frameValue } from './columns.ts';
import { toConnectorError } from './errors.ts';
import { mariadbConnector } from './mariadb-connector.ts';
import { mysqlConnector } from './mysql-connector.ts';

for (const kind of [mysqlConnector, mariadbConnector]) {
  testConnectorConformance(kind, {
    config: { host: 'orders-replica', database: 'orders', username: 'dash_ro' },
    secret: { password: 'x' },
    query: { language: 'sql', text: 'SELECT 1', parameters: [] },
    invalidQuery: { language: 'sql', text: 'SELEC 1', parameters: [] },
    sampleField: { entity: 'orders', field: 'status' },
    timeRange: { from: new Date(0), to: new Date(1000) },
    live: false,
  });
}

describe('mysql and mariadb connector targets', () => {
  test('are connection URLs without the password, in the scheme of each product', () => {
    const settings = { host: 'orders-replica', database: 'orders', username: 'dash_ro' };
    expect(mysqlConnector.describeTarget?.(mysqlConnector.configSchema.parse(settings))).toBe(
      'mysql://dash_ro@orders-replica:3306/orders',
    );
    expect(mariadbConnector.describeTarget?.(mariadbConnector.configSchema.parse(settings))).toBe(
      'mariadb://dash_ro@orders-replica:3306/orders',
    );
  });
});

describe('mysql column types', () => {
  test('maps result column codes to number, time and string', () => {
    expect([0, 1, 2, 3, 4, 5, 8, 9, 13, 246].map(fieldTypeOf)).toEqual(Array(10).fill('number'));
    expect([7, 10, 12].map(fieldTypeOf)).toEqual(['time', 'time', 'time']);
    expect([11, 15, 245, 247, 252, 253, 254, undefined].map(fieldTypeOf)).toEqual(
      Array(8).fill('string'),
    );
  });

  test('maps catalog type names the same way', () => {
    expect(['bigint', 'DECIMAL', 'double', 'year'].map(fieldTypeOfName)).toEqual(
      Array(4).fill('number'),
    );
    expect(['datetime', 'timestamp', 'date'].map(fieldTypeOfName)).toEqual(Array(3).fill('time'));
    expect(['varchar', 'json', 'time', 'enum'].map(fieldTypeOfName)).toEqual(
      Array(4).fill('string'),
    );
  });

  test('turns big numbers, dates, bytes and JSON into frame values', () => {
    expect(frameValue('number', '9007199254740993')).toBe(9007199254740992);
    expect(frameValue('time', new Date('2026-09-27T12:02:00Z'))).toBe(Date.UTC(2026, 8, 27, 12, 2));
    expect(frameValue('string', new TextEncoder().encode('bytes'))).toBe('bytes');
    expect(frameValue('string', { a: 1 })).toBe('{"a":1}');
    expect(frameValue('number', null)).toBeNull();
  });
});

describe('mysql errors', () => {
  test('map server errors to codes with messages that quote no values', () => {
    const cases: [object, string, string][] = [
      [{ errno: 1064, message: "near 'secret'" }, 'syntax', 'The query has a syntax error.'],
      [{ errno: 1045, message: "denied for 'dash_ro'" }, 'authentication', 'refused'],
      [{ errno: 1792, message: 'READ ONLY' }, 'rejected', 'connectors only read'],
      [{ errno: 1317, message: 'interrupted' }, 'timeout', 'cancelled'],
      [{ errno: 1292, message: "Incorrect value: 'secret'" }, 'syntax', 'wrong type'],
      [{ errno: 3141, message: "Invalid JSON in 'secret'" }, 'internal', 'error 3141'],
    ];
    for (const [driverError, code, safe] of cases) {
      const error = toConnectorError(driverError);
      expect(error).toMatchObject({ code });
      expect(error.safeMessage).toContain(safe);
      expect(error.safeMessage).not.toContain('secret');
    }
  });

  test('name a missing table or column, which is schema rather than data', () => {
    expect(
      toConnectorError({ errno: 1146, message: "Table 'orders.nope' doesn't exist" }),
    ).toMatchObject({ code: 'not_found', safeMessage: 'Table "orders.nope" does not exist.' });
    expect(
      toConnectorError({ errno: 1054, message: "Unknown column 'nope' in 'field list'" }),
    ).toMatchObject({ code: 'not_found', safeMessage: 'Column "nope" does not exist.' });
  });

  test('tell an unreachable server from a driver failure, and keep connector errors', () => {
    expect(toConnectorError({ code: 'ECONNREFUSED', errno: -111 })).toMatchObject({
      code: 'unreachable',
    });
    expect(toConnectorError(new Error('boom'))).toMatchObject({ code: 'internal' });
    const known = new ConnectorError('timeout', 'Too slow.');
    expect(toConnectorError(known)).toBe(known);
  });
});
