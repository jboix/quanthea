import { describe, expect, test } from 'bun:test';
import { healthQuery, readOnlyUser, userAccess } from './health.ts';

describe('what a MySQL or MariaDB user may do', () => {
  test('a user with no write privilege and no role is read-only', () => {
    expect(userAccess(['8.4.11', 'dash_ro@%', null], 'NONE')).toEqual({
      readOnly: true,
      canDo: [],
      access: 'has no write grants',
    });
    expect(userAccess(['13.0.2-MariaDB', 'dash_ro@%', null], null).readOnly).toBe(true);
  });

  test('a user with write privileges can write, and they are named', () => {
    expect(userAccess(['8.4.11', 'app@%', 'DELETE, DROP, INSERT, UPDATE'], 'NONE')).toEqual({
      readOnly: false,
      canDo: ['It holds the privileges DELETE, DROP, INSERT, UPDATE.'],
      access: 'can write: use a read-only user',
    });
  });

  test('a user with an active role is unknown, never read-only', () => {
    const access = userAccess(['8.4.11', 'dash@%', null], '`writers`@`%`');
    expect(access.readOnly).toBeNull();
    expect(access.access).toContain('unknown');
  });

  test('the question only reads the catalog', () => {
    expect(healthQuery).not.toMatch(/\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE TABLE)\b/);
    expect(healthQuery.trimStart()).toStartWith('SELECT');
  });

  test('gives the user to create, with the database quoted', () => {
    expect(readOnlyUser('or`ders')).toContain(
      "GRANT SELECT ON `or``ders`.* TO 'quanthea_read'@'%';",
    );
  });
});
