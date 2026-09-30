/** The connection test of a ClickHouse connector: the server, the user and whether it can write. */
import { ConnectorError, type HealthReport } from '../_shared/index.ts';
import { type Access, type ClickhouseSession, readonlyOneError } from './session.ts';

/** Privileges that change data, the schema, the server or its users. */
const writePrivilege =
  /^(?:ALL|INSERT|ALTER|CREATE|DROP|UNDROP|TRUNCATE|OPTIMIZE|SYSTEM|KILL|BACKUP|MOVE|ACCESS MANAGEMENT|ROLE ADMIN)\b/;

/**
 * Whether a GRANT statement gives a privilege that writes.
 *
 * @param statement - One line of `SHOW GRANTS`, such as `GRANT SELECT ON orders.* TO dash_ro`.
 * @returns `true` when one of its privileges writes; `false` for a role grant or a REVOKE.
 */
export function grantsWrite(statement: string): boolean {
  const privileges = /^GRANT (.+?) ON /.exec(statement)?.[1];
  if (privileges === undefined) return false;
  return privileges
    .replace(/\([^)]*\)/g, '')
    .split(',')
    .some((privilege) => writePrivilege.test(privilege.trim()));
}

/**
 * Whether the user can write, from its grants and those of its roles.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns `true` when no grant writes.
 */
async function hasNoWriteGrant(session: ClickhouseSession, signal: AbortSignal): Promise<boolean> {
  const { rows } = await session.run({
    sql: 'SHOW GRANTS FINAL',
    parameters: [],
    rowLimit: 10_000,
    timeoutMs: 10_000,
    signal,
  });
  return !rows.some((row) => grantsWrite(String(row[0])));
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
 * Checks the connection and whether the user can write.
 *
 * @param session - The session.
 * @param signal - The caller's signal.
 * @returns The health report. A user whose `readonly` is 1 fails it: the connector cannot run.
 */
export async function testConnection(
  session: ClickhouseSession,
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
    const readOnly = access.readonly === 2 || (await hasNoWriteGrant(session, signal));
    const message = `${server} ${accessSentence(access, readOnly)}`;
    return { ok: true, latencyMs: latencyMs(), message, readOnly };
  } catch (error) {
    const message = error instanceof ConnectorError ? error.safeMessage : 'The test failed.';
    return { ok: false, latencyMs: latencyMs(), message, readOnly: null };
  }
}
