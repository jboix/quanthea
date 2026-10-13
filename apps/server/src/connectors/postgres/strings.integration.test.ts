import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import type { ConnectorInstance } from '../_shared/index.ts';
import { devPostgresOwner, integrationEnabled } from '../_shared/test/dev-sources.ts';
import { postgresConnector } from './postgres-connector.ts';

/** A role that can write and whose strings take backslash escapes, as a server may set them. */
const role = 'quanthea_test_backslashes';

/** The table the hidden statement would drop. */
const table = 'quanthea_test_kept';

const timeRange = { from: new Date('2026-09-27T12:00:00Z'), to: new Date('2026-09-27T13:00:00Z') };

/**
 * A statement the SQL binder reads as one SELECT of two strings, and binds unchanged. A server
 * that reads `\'` as an escaped quote ends the first string later, and would see a COMMIT and a
 * DROP after it.
 */
const hidden = String.raw`SELECT '\' || ') AS q; COMMIT; DROP TABLE ${table}; BEGIN; SELECT * FROM (SELECT 1 --'`;

describe.skipIf(!integrationEnabled)('a role whose strings take backslash escapes', () => {
  const admin = postgres({
    ...devPostgresOwner.config,
    ...devPostgresOwner.secret,
    ssl: false,
    max: 1,
    onnotice: () => undefined,
  });
  let connection: ConnectorInstance;

  beforeAll(async () => {
    await admin.unsafe(`
      DROP TABLE IF EXISTS ${table};
      DROP ROLE IF EXISTS ${role};
      CREATE ROLE ${role} LOGIN PASSWORD 'quanthea-dev';
      ALTER ROLE ${role} SET standard_conforming_strings = off;
      CREATE TABLE ${table} (a int);
      ALTER TABLE ${table} OWNER TO ${role};`);
    connection = postgresConnector.open({
      config: postgresConnector.configSchema.parse({ ...devPostgresOwner.config, username: role }),
      secret: { password: 'quanthea-dev' },
    });
  });

  afterAll(async () => {
    await connection.close();
    await admin.unsafe(`DROP TABLE IF EXISTS ${table}; DROP ROLE IF EXISTS ${role};`);
    await admin.end();
  });

  test('reads a statement as the binder did, so nothing hides in a string', async () => {
    const [frame] = await connection.execute(
      { language: 'sql', text: hidden, parameters: [] },
      {
        refId: 'A',
        signal: AbortSignal.timeout(10_000),
        timeoutMs: 10_000,
        maxRows: 10,
        timeRange,
      },
    );
    expect(String(frame?.values[0]?.[0])).toContain('DROP TABLE');
    const kept = await admin`SELECT to_regclass(${table}) IS NOT NULL AS kept`;
    expect(kept[0]?.kept).toBe(true);
  });
});
