/**
 * What the connection test of a PostgreSQL connector asks and says: the server, the role, and
 * what the role may do beyond reading. The question reads the catalog only, and tries no write.
 */
import { quoteIdentifier } from './catalog.ts';

/** The relations of the database's own schemas. */
const ownRelations = `
  pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'`;

/**
 * The tables, views and foreign tables the role can change: by a grant on the table, or on some
 * of its columns only, such as `GRANT UPDATE (status) ON orders`.
 */
const userRelations = `${ownRelations}
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
      OR has_any_column_privilege(c.oid, 'INSERT, UPDATE'))`;

/**
 * Checks the server and what the role may do, without touching table data. A privilege counts
 * however the role holds it: granted, inherited from a role, given to everyone, or as the owner.
 */
export const healthQuery = `
SELECT current_setting('server_version') AS version, current_user AS role,
  current_database() AS database,
  r.rolsuper AS superuser, r.rolcreaterole AS create_role, r.rolcreatedb AS create_database,
  has_database_privilege(current_database(), 'CREATE') AS create_schema,
  ARRAY(SELECT n.nspname::text FROM pg_namespace n
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND has_schema_privilege(n.oid, 'CREATE') ORDER BY 1 LIMIT 10) AS create_in,
  (SELECT count(*)::int FROM ${userRelations}) AS writable,
  ARRAY(SELECT n.nspname || '.' || c.relname FROM ${userRelations} ORDER BY 1 LIMIT 3) AS examples,
  (SELECT count(*)::int FROM ${ownRelations}
    AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(c.oid, 'UPDATE') END) AS sequences,
  ARRAY(SELECT m.rolname::text FROM pg_roles m
    WHERE m.rolname IN ('pg_write_all_data', 'pg_write_server_files',
      'pg_read_server_files', 'pg_execute_server_program')
      AND pg_has_role(current_user, m.oid, 'USAGE') ORDER BY 1) AS server_roles,
  (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') AS timescaledb
FROM pg_roles r WHERE r.rolname = current_user`;

/** The row of {@link healthQuery}. */
export interface HealthRow {
  /** The server version. */
  readonly version: string;
  /** The role the connector uses. */
  readonly role: string;
  /** The database it reads. */
  readonly database: string;
  /** Whether the role is a superuser. */
  readonly superuser: boolean;
  /** Whether it can create roles. */
  readonly create_role: boolean;
  /** Whether it can create databases. */
  readonly create_database: boolean;
  /** Whether it can create schemas in the database. */
  readonly create_schema: boolean;
  /** The schemas it can create tables in, ten at most. */
  readonly create_in: readonly string[];
  /** How many tables and views it can insert into, update, delete from or truncate. */
  readonly writable: number;
  /** Three of them. */
  readonly examples: readonly string[];
  /** How many sequences it can set. */
  readonly sequences: number;
  /** The server's own roles it holds that write data, read or write files, or run programs. */
  readonly server_roles: readonly string[];
  /** The TimescaleDB version, when the database has the extension. */
  readonly timescaledb: string | null;
}

/**
 * The sentence about the tables a role can change.
 *
 * @param row - The health row.
 * @returns The sentence, or none when it can change no table.
 */
function writableSentence(row: HealthRow): string[] {
  if (row.writable === 0) return [];
  const named = row.examples.join(', ');
  const count = row.writable === 1 ? '1 table' : `${row.writable} tables`;
  const such = row.writable > row.examples.length ? `, such as ${named}` : `: ${named}`;
  return [`It can insert, update or delete in ${count}${such}.`];
}

/**
 * What a role may do beyond reading, from its health row.
 *
 * @param row - The health row.
 * @returns One sentence per finding; a superuser's says it all.
 */
export function roleFindings(row: HealthRow): string[] {
  if (row.superuser)
    return ["It is a superuser: it can change every database and the server's files."];
  const one = (holds: boolean, sentence: string): string[] => (holds ? [sentence] : []);
  return [
    ...writableSentence(row),
    ...one(
      row.sequences > 0,
      `It can set ${row.sequences === 1 ? '1 sequence' : `${row.sequences} sequences`}.`,
    ),
    ...one(row.create_in.length > 0, `It can create tables in ${row.create_in.join(', ')}.`),
    ...one(row.create_schema, `It can create schemas in the database ${row.database}.`),
    ...one(row.server_roles.length > 0, `It is a member of ${row.server_roles.join(', ')}.`),
    ...one(row.create_role, 'It can create roles.'),
    ...one(row.create_database, 'It can create databases.'),
  ];
}

/**
 * The statements that make a role that only reads the database, for the admin to copy.
 *
 * @param database - The database the connector reads.
 * @returns The statements. The last one ends the right every role has to create tables in
 *   `public` where it still holds, without which the new role would be reported as writing.
 */
export function readOnlyRole(database: string): string {
  return `CREATE ROLE quanthea_read LOGIN PASSWORD 'choose-a-password';
GRANT CONNECT ON DATABASE ${quoteIdentifier(database)} TO quanthea_read;
GRANT USAGE ON SCHEMA public TO quanthea_read;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO quanthea_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO quanthea_read;
ALTER ROLE quanthea_read SET default_transaction_read_only = on;
-- PostgreSQL 14 and earlier, and a database upgraded from one, let every role create tables in
-- public. This takes that from all of them: grant it again to the roles that need it.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;`;
}

/**
 * What the test says of a row: the server, the role and whether it can write.
 *
 * @param row - The health row, if the role was found.
 * @returns The message, whether the role only reads, what it can do beyond, and the fix.
 */
export function healthOf(row: HealthRow | undefined) {
  const canDo = row ? roleFindings(row) : [];
  const readOnly = row !== undefined && canDo.length === 0;
  const access = readOnly ? 'has no write grants' : 'can write: use a read-only role';
  const timescale = row?.timescaledb ? ` with TimescaleDB ${row.timescaledb}` : '';
  const message = `PostgreSQL ${row?.version ?? '?'}${timescale}. Role ${row?.role ?? '?'} ${access}.`;
  return { message, readOnly, canDo, readOnlySetup: readOnlyRole(row?.database ?? 'database') };
}
