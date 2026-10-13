/** The connection test of a ClickHouse connector: the server, the user and whether it can write. */
import { ConnectorError, type HealthReport } from '../_shared/index.ts';
import { type Access, type ClickhouseSession, readonlyOneError } from './session.ts';

/** Privileges that change data, the schema, the server or its users. */
const writePrivilege =
  /^(?:ALL|INSERT|ALTER|CREATE|DROP|UNDROP|TRUNCATE|OPTIMIZE|SYSTEM|KILL|BACKUP|MOVE|ACCESS MANAGEMENT|ROLE ADMIN)\b/;

/**
 * The privileges of a GRANT statement that write, with what they are granted on.
 *
 * @param statement - One line of `SHOW GRANTS`, such as `GRANT SELECT ON orders.* TO dash_ro`.
 * @returns Such as `INSERT, ALTER TABLE on orders.*`, or `undefined` when none writes, as for a
 *   role grant or a REVOKE.
 */
export function writingGrant(statement: string): string | undefined {
  const [, privileges, target] = /^GRANT (.+?) ON (.+?) TO /.exec(statement) ?? [];
  if (privileges === undefined) return undefined;
  const writes = privileges
    .replace(/\([^)]*\)/g, '')
    .split(',')
    .map((privilege) => privilege.trim())
    .filter((privilege) => writePrivilege.test(privilege));
  return writes.length > 0 ? `${writes.join(', ')} on ${target}` : undefined;
}

/** The most grants a report names. */
const namedGrants = 5;

/**
 * What the user's grants, and those of its roles, allow beyond reading. `SHOW GRANTS` only reads.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns One sentence per grant that writes, the first few.
 */
async function writeFindings(session: ClickhouseSession, signal: AbortSignal): Promise<string[]> {
  const { rows } = await session.run({
    sql: 'SHOW GRANTS FINAL',
    parameters: [],
    rowLimit: 10_000,
    timeoutMs: 10_000,
    signal,
  });
  const grants = rows.flatMap((row) => writingGrant(String(row[0])) ?? []);
  const more = grants.length > namedGrants ? [`It holds ${grants.length - namedGrants} more.`] : [];
  return [...grants.slice(0, namedGrants).map((grant) => `It holds ${grant}.`), ...more];
}

/**
 * The sentence about the user.
 *
 * @param access - The user's access.
 * @param readOnly - Whether the user cannot write.
 * @returns Such as `User dash_ro has no write grants.`
 */
function accessSentence(access: Access, readOnly: boolean): string {
  if (access.readonly === 2) return `User ${access.user} is read-only (readonly=2).`;
  return `User ${access.user} ${readOnly ? 'has no write grants' : 'can write: use a read-only user'}.`;
}

/**
 * The statements that make a user that only reads the database, for the admin to copy.
 *
 * @param database - The database the connector reads.
 * @returns The statements.
 */
export function readOnlyUser(database: string): string {
  const quoted = `\`${database.replaceAll('`', '``')}\``;
  return `CREATE USER quanthea_read IDENTIFIED BY 'choose-a-password' SETTINGS readonly = 2;
GRANT SELECT ON ${quoted}.* TO quanthea_read;`;
}

/**
 * Checks the connection and what the user may do beyond reading.
 *
 * @param session - The session.
 * @param database - The database the connector reads, for the statements of a read-only user.
 * @param signal - The caller's signal.
 * @returns The health report. A user whose `readonly` is 1 fails it: the connector cannot run.
 */
export async function testConnection(
  session: ClickhouseSession,
  database: string,
  signal: AbortSignal,
): Promise<HealthReport> {
  const started = performance.now();
  const latencyMs = (): number => Math.round(performance.now() - started);
  try {
    const access = await session.access();
    const server = `ClickHouse ${access.version}.`;
    if (access.readonly === 1) {
      const message = `${server} ${readonlyOneError.safeMessage}`;
      return { ok: false, latencyMs: latencyMs(), message, readOnly: true };
    }
    const canDo = access.readonly === 2 ? [] : await writeFindings(session, signal);
    const readOnly = canDo.length === 0;
    const message = `${server} ${accessSentence(access, readOnly)}`;
    const readOnlySetup = readOnlyUser(database);
    return { ok: true, latencyMs: latencyMs(), message, readOnly, canDo, readOnlySetup };
  } catch (error) {
    const message = error instanceof ConnectorError ? error.safeMessage : 'The test failed.';
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}
