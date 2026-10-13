import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import type { ConnectorInstance } from '../_shared/index.ts';
import { devPostgresOwner, integrationEnabled } from '../_shared/test/dev-sources.ts';
import { postgresConnector } from './postgres-connector.ts';

/** A role with no grant of its own: what it may do comes from the group it is a member of. */
const member = 'quanthea_test_member';

/** The group, which may change one table and create tables in a schema. */
const group = 'quanthea_test_writers';

/** The schema the group may create tables in. */
const schema = 'quanthea_test_scratch';

describe.skipIf(!integrationEnabled)('what the test says of a role that can write', () => {
  const admin = postgres({
    ...devPostgresOwner.config,
    ...devPostgresOwner.secret,
    ssl: false,
    max: 1,
    onnotice: () => undefined,
  });
  let connection: ConnectorInstance;

  /**
   * How many rows the orders table has and how many tables the database has.
   *
   * @returns The two counts, as text.
   */
  async function state(): Promise<string> {
    const [row] = await admin`
      SELECT (SELECT count(*) FROM orders) || ' rows, ' ||
        (SELECT count(*) FROM pg_class WHERE relkind = 'r') || ' tables' AS state`;
    return String(row?.state);
  }

  beforeAll(async () => {
    await admin
      .unsafe(`
      DROP SCHEMA IF EXISTS ${schema};
      DROP ROLE IF EXISTS ${member};
      DROP OWNED BY ${group};
      DROP ROLE IF EXISTS ${group};`)
      .catch(() => undefined);
    await admin.unsafe(`
      CREATE ROLE ${group};
      CREATE ROLE ${member} LOGIN PASSWORD 'quanthea-dev' IN ROLE ${group};
      CREATE SCHEMA ${schema};
      GRANT USAGE, CREATE ON SCHEMA ${schema} TO ${group};
      GRANT USAGE ON SCHEMA public TO ${group};
      GRANT SELECT, INSERT, DELETE ON orders TO ${group};`);
    connection = postgresConnector.open({
      config: postgresConnector.configSchema.parse({
        ...devPostgresOwner.config,
        username: member,
      }),
      secret: { password: 'quanthea-dev' },
    });
  });

  afterAll(async () => {
    await connection.close();
    await admin.unsafe(`
      DROP SCHEMA IF EXISTS ${schema};
      DROP ROLE IF EXISTS ${member};
      DROP OWNED BY ${group};
      DROP ROLE IF EXISTS ${group};`);
    await admin.end();
  });

  test('names what the role holds through a group, and writes nothing to find out', async () => {
    const before = await state();
    const health = await connection.test(AbortSignal.timeout(10_000));
    expect(health).toMatchObject({ ok: true, readOnly: false });
    expect(health.canDo).toEqual([
      'It can insert, update or delete in 1 table: public.orders.',
      `It can create tables in ${schema}.`,
    ]);
    expect(health.message).toContain(`Role ${member} can write`);
    expect(await state()).toBe(before);
  });
});
