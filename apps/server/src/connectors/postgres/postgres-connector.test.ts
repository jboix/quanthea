import { describe, expect, test } from 'bun:test';
import { postgresConnector } from './postgres-connector.ts';

describe('postgres connector target', () => {
  test('is a connection URL without the password', () => {
    const config = postgresConnector.configSchema.parse({
      host: 'orders-replica',
      database: 'orders',
      username: 'dash_ro',
    });
    expect(postgresConnector.describeTarget?.(config)).toBe(
      'postgres://dash_ro@orders-replica:5432/orders',
    );
  });
});
