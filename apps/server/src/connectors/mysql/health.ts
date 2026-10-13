/**
 * What the connection test of a MySQL or MariaDB connector asks and says: the server, the user,
 * and what the user may do beyond reading. The question reads `information_schema` only, and
 * tries no write.
 */
import { quoteIdentifier } from './catalog.ts';

/** Privileges that let a user change data, the schema, the server or its users. */
const writePrivileges = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'INDEX',
  'CREATE VIEW',
  'CREATE ROUTINE',
  'ALTER ROUTINE',
  'TRIGGER',
  'EVENT',
  'FILE',
  'SUPER',
  'CREATE USER',
  'RELOAD',
  'SHUTDOWN',
];

/** The write privileges as quoted SQL strings, for an `IN` list. */
const writePrivilegeList = writePrivileges.map((privilege) => `'${privilege}'`).join(', ');

/**
 * Checks the server and names the write privileges granted to the user itself, on the server, a
 * schema or a table, without touching table data. Those of an active role are not listed there,
 * so {@link roleQuery} reads the role too.
 */
export const healthQuery = `
SELECT VERSION() AS version, CURRENT_USER() AS user_name, (
  SELECT GROUP_CONCAT(DISTINCT grants.PRIVILEGE_TYPE ORDER BY grants.PRIVILEGE_TYPE SEPARATOR ', ')
  FROM (
    SELECT GRANTEE, PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES
    UNION ALL SELECT GRANTEE, PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES
    UNION ALL SELECT GRANTEE, PRIVILEGE_TYPE FROM information_schema.TABLE_PRIVILEGES
  ) AS grants
  WHERE grants.GRANTEE = CONCAT('''', REPLACE(CURRENT_USER(), '@', '''@'''), '''')
    AND grants.PRIVILEGE_TYPE IN (${writePrivilegeList})
) AS write_privileges`;

/** Reads the roles active in the session. A server without roles has no such function. */
export const roleQuery = 'SELECT CURRENT_ROLE()';

/**
 * The row of {@link healthQuery}: the server version (which names MariaDB on MariaDB), the user
 * with its host, and its write privileges.
 */
export type HealthRow = [version?: string, user?: string, writes?: string | null];

/** What a row says about the user. */
interface UserAccess {
  /** Whether the user only reads, or `null` when a role's grants are not known. */
  readonly readOnly: boolean | null;
  /** What it can do beyond reading. */
  readonly canDo: readonly string[];
  /** The end of the sentence about the user, after its name. */
  readonly access: string;
}

/**
 * What a user may do beyond reading, from its health row.
 *
 * @param row - The health row.
 * @param role - The session's active roles: `NONE` or nothing when it has none.
 * @returns Able to write with its privileges, unknown with an active role, else read-only.
 */
export function userAccess(row: HealthRow, role: string | null): UserAccess {
  const [, , writes] = row;
  if (writes)
    return {
      readOnly: false,
      canDo: [`It holds the privileges ${writes}.`],
      access: 'can write: use a read-only user',
    };
  if (role && role.toUpperCase() !== 'NONE')
    return {
      readOnly: null,
      canDo: [],
      access: `holds the role ${role}, whose grants the test does not read: whether it can write is unknown`,
    };
  return { readOnly: true, canDo: [], access: 'has no write grants' };
}

/**
 * The statements that make a user that only reads the database, for the admin to copy.
 *
 * @param database - The database the connector reads.
 * @returns The statements.
 */
export function readOnlyUser(database: string): string {
  return `CREATE USER 'quanthea_read'@'%' IDENTIFIED BY 'choose-a-password';
GRANT SELECT ON ${quoteIdentifier(database)}.* TO 'quanthea_read'@'%';`;
}
