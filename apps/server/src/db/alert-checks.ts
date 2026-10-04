/**
 * Whether an alert can be checked, as stored: the failed evaluations in a row, when it went into
 * error and whether that was announced, on the alert's row; and what happened to it, the
 * `alert_check_events` the "What happened" timeline shows. The state repository writes them in
 * the transaction of an evaluation.
 */
import type { Database } from 'bun:sqlite';

/** Whether an alert can be checked. */
export interface CheckState {
  /** The evaluations in a row whose query failed. */
  readonly failures: number;
  /** When it went into error; `null` while it can be checked. */
  readonly errorSince: number | null;
  /** Whether it announced being in error, and has not announced recovering since. */
  readonly notified: boolean;
}

/** What happened to whether an alert can be checked. */
export interface CheckEventRow {
  /** It went into error, or can be checked again. */
  readonly kind: 'error' | 'recovered';
  /** When. */
  readonly at: number;
  /** Why the query failed, for `error`. */
  readonly reason: string | null;
  /** Whether it sent a notification. */
  readonly notified: boolean;
}

/** The state of an alert that never failed. */
export const checkable: CheckState = { failures: 0, errorSince: null, notified: false };

/** The check state as SQLite returns it. */
interface StoredCheck {
  /** Failures in a row. */
  failed_checks: number;
  /** In error since. */
  check_error_since: number | null;
  /** 0 or 1. */
  check_error_notified: number;
}

/** A check event as SQLite returns it. */
interface StoredCheckEvent {
  /** The kind. */
  kind: CheckEventRow['kind'];
  /** When. */
  at: number;
  /** Why. */
  reason: string | null;
  /** 0 or 1. */
  notified: number;
}

/**
 * Prepares the statements.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
export function checkStatements(database: Database) {
  return {
    state: database.query<StoredCheck, [string]>(
      `SELECT failed_checks, check_error_since, check_error_notified FROM alerts WHERE id = ?`,
    ),
    save: database.query(
      `UPDATE alerts SET failed_checks = ?, check_error_since = ?, check_error_notified = ?
       WHERE id = ?`,
    ),
    events: database.query<StoredCheckEvent, [string, number]>(
      `SELECT kind, at, reason, notified FROM alert_check_events WHERE alert_id = ?
       ORDER BY at DESC, id DESC LIMIT ?`,
    ),
    insert: database.query(
      `INSERT INTO alert_check_events (id, alert_id, kind, at, reason, notified)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    purge: database.query('DELETE FROM alert_check_events WHERE at < ?'),
  };
}

/** The prepared statements. */
export type CheckStatements = ReturnType<typeof checkStatements>;

/**
 * Reads whether an alert can be checked.
 *
 * @param statements - The prepared statements.
 * @param alertId - The alert.
 * @returns Its state; that of an alert that never failed when there is no such alert.
 */
export function readCheck(statements: CheckStatements, alertId: string): CheckState {
  const stored = statements.state.get(alertId);
  if (!stored) return checkable;
  return {
    failures: stored.failed_checks,
    errorSince: stored.check_error_since,
    notified: stored.check_error_notified === 1,
  };
}

/**
 * Writes whether an alert can be checked, and what happened to it.
 *
 * @param statements - The prepared statements.
 * @param alertId - The alert.
 * @param state - Its new state.
 * @param event - What happened, with its id, if anything.
 */
export function writeCheck(
  statements: CheckStatements,
  alertId: string,
  state: CheckState,
  event: (CheckEventRow & { readonly id: string }) | null,
): void {
  statements.save.run(state.failures, state.errorSince, Number(state.notified), alertId);
  if (event === null) return;
  const { id, kind, at, reason, notified } = event;
  statements.insert.run(id, alertId, kind, at, reason, Number(notified));
}

/**
 * Reads the latest check events of an alert.
 *
 * @param statements - The prepared statements.
 * @param alertId - The alert.
 * @param limit - The most to return.
 * @returns The events, the latest first.
 */
export function readCheckEvents(
  statements: CheckStatements,
  alertId: string,
  limit: number,
): CheckEventRow[] {
  return statements.events.all(alertId, limit).map((stored) => ({
    kind: stored.kind,
    at: stored.at,
    reason: stored.reason,
    notified: stored.notified === 1,
  }));
}
