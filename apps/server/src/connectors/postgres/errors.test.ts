import { describe, expect, test } from 'bun:test';
import { ConnectorError } from '../_shared/index.ts';
import { toConnectorError } from './errors.ts';

describe('toConnectorError', () => {
  test('keeps the server message but never quotes a value in the safe message', () => {
    const error = toConnectorError({
      code: '22P02',
      message: 'invalid input syntax for type integer: "jane@example.com"',
    });
    expect(error.code).toBe('syntax');
    expect(error.message).toContain('jane@example.com');
    expect(error.safeMessage).not.toContain('jane');
    expect(error.safeMessage).toBe('A value has the wrong type or format (SQLSTATE 22P02).');
  });

  test('names the missing table or column, which are schema, not data', () => {
    expect(
      toConnectorError({ code: '42P01', message: 'relation "ordrs" does not exist' }).safeMessage,
    ).toBe('Table or view "ordrs" does not exist.');
    expect(
      toConnectorError({ code: '42703', message: 'column "stauts" does not exist' }).safeMessage,
    ).toBe('Column "stauts" does not exist.');
  });

  test('maps writes, timeouts, authentication and unreachable servers', () => {
    expect(
      toConnectorError({
        code: '25006',
        message: 'cannot execute DELETE in a read-only transaction',
      }).code,
    ).toBe('rejected');
    expect(
      toConnectorError({ code: '57014', message: 'canceling statement due to statement timeout' })
        .code,
    ).toBe('timeout');
    expect(
      toConnectorError({ code: '28P01', message: 'password authentication failed for user "x"' })
        .code,
    ).toBe('authentication');
    expect(
      toConnectorError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5433' })
        .code,
    ).toBe('unreachable');
  });

  test('reports unknown SQLSTATEs and non-database errors generically', () => {
    expect(toConnectorError({ code: 'XX000', message: 'internal error: secret' }).safeMessage).toBe(
      'The database reported an error (SQLSTATE XX000).',
    );
    expect(toConnectorError(new Error('boom')).safeMessage).toBe('The database driver failed.');
  });

  test('passes a ConnectorError through', () => {
    const original = new ConnectorError('not_found', 'Column "x" does not exist.');
    expect(toConnectorError(original)).toBe(original);
  });
});
