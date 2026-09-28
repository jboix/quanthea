/** Reads raw rows for tests that check what is stored, such as sealed bytes and audit events. */
import type { Database } from 'bun:sqlite';

/**
 * The actions in the audit log, oldest first.
 *
 * @param database - The database.
 * @returns The actions.
 */
export function auditActions(database: Database): string[] {
  return database
    .query<{ action: string }, []>('SELECT action FROM audit_log ORDER BY id')
    .all()
    .map((row) => row.action);
}

/**
 * The stored secret bytes of every connector.
 *
 * @param database - The database.
 * @returns The sealed bytes, one entry per connector.
 */
export function storedSecrets(database: Database): Uint8Array[] {
  return database
    .query<{ secret: Uint8Array }, []>('SELECT secret FROM connectors')
    .all()
    .map((row) => new Uint8Array(row.secret));
}
