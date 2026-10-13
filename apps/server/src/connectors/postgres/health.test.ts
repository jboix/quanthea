import { describe, expect, test } from 'bun:test';
import { type HealthRow, healthOf, readOnlyRole, roleFindings } from './health.ts';

/** A role that only reads. */
const reader: HealthRow = {
  version: '18.6',
  role: 'dash_ro',
  database: 'orders',
  superuser: false,
  create_role: false,
  create_database: false,
  create_schema: false,
  create_in: [],
  writable: 0,
  examples: [],
  sequences: 0,
  server_roles: [],
  timescaledb: null,
};

describe('what a PostgreSQL role may do', () => {
  test('a role with no finding is read-only', () => {
    expect(healthOf(reader)).toMatchObject({
      readOnly: true,
      canDo: [],
      message: 'PostgreSQL 18.6. Role dash_ro has no write grants.',
    });
  });

  test('a superuser says it all in one sentence', () => {
    const findings = roleFindings({ ...reader, superuser: true, writable: 40, create_role: true });
    expect(findings).toEqual([
      "It is a superuser: it can change every database and the server's files.",
    ]);
  });

  test('names the tables it can change, the schemas it can create in and the roles it holds', () => {
    const row: HealthRow = {
      ...reader,
      create_schema: true,
      create_in: ['public', 'staging'],
      writable: 12,
      examples: ['public.customers', 'public.orders', 'public.payments'],
      server_roles: ['pg_write_all_data'],
      create_database: true,
    };
    expect(healthOf(row)).toMatchObject({
      readOnly: false,
      canDo: [
        'It can insert, update or delete in 12 tables, such as public.customers, public.orders, public.payments.',
        'It can create tables in public, staging.',
        'It can create schemas in the database orders.',
        'It is a member of pg_write_all_data.',
        'It can create databases.',
      ],
    });
    expect(healthOf(row).message).toContain('can write: use a read-only role');
  });

  test('a role that creates in public as everyone does is shown how to end that', () => {
    const health = healthOf({ ...reader, role: 'quanthea_read', create_in: ['public'] });
    expect(health.readOnly).toBe(false);
    expect(health.canDo).toEqual(['It can create tables in public.']);
    expect(health.readOnlySetup).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC;');
  });

  test('a role that can set a sequence is not read-only', () => {
    expect(roleFindings({ ...reader, sequences: 1 })).toEqual(['It can set 1 sequence.']);
    expect(healthOf({ ...reader, sequences: 2 }).readOnly).toBe(false);
  });

  test('lists every table when there are few', () => {
    expect(roleFindings({ ...reader, writable: 1, examples: ['public.orders'] })).toEqual([
      'It can insert, update or delete in 1 table: public.orders.',
    ]);
  });

  test('a role the server did not find is not called read-only', () => {
    expect(healthOf(undefined).readOnly).toBe(false);
  });

  test('gives the role to create, with the database quoted', () => {
    const setup = readOnlyRole('my "orders"');
    expect(setup).toContain('GRANT CONNECT ON DATABASE "my ""orders""" TO quanthea_read;');
    expect(setup).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA public TO quanthea_read;');
    expect(setup).not.toMatch(/INSERT|UPDATE|DELETE|ALL PRIVILEGES/);
  });
});
