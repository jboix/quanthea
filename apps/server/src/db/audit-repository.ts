/** Appends to the audit log: who did what, for accountability. */
import type { Database } from 'bun:sqlite';
import { newId } from '../lib/ids.ts';

/** One audit event. */
export interface AuditEntry {
  /** The principal id of whoever acted. */
  readonly actor: string;
  /** What they did, such as `connector.create`. */
  readonly action: string;
  /** What they acted on, such as a connector id. */
  readonly target?: string;
  /** Context worth keeping, as JSON-serializable data. Never credentials. */
  readonly detail?: unknown;
}

/** Writes audit events. */
export interface AuditRepository {
  /**
   * Records an event now.
   *
   * @param entry - The event.
   */
  append(entry: AuditEntry): void;
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createAuditRepository(database: Database): AuditRepository {
  const insert = database.query(
    'INSERT INTO audit_log (id, at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)',
  );
  return {
    append: (entry) => {
      const detail = entry.detail === undefined ? null : JSON.stringify(entry.detail);
      insert.run(newId(), Date.now(), entry.actor, entry.action, entry.target ?? null, detail);
    },
  };
}
