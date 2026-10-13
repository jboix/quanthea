/**
 * Reads the lists of an alert's page a page at a time: what happened to it (its series' changes
 * of state, the times it could not be checked or could be again, and what people did to it, from
 * the audit log) and the messages sent about it. Every list is in one order, the latest first and
 * then by id, and a page holds the entries after a cursor in that order: an entry that arrives
 * later is newer than every cursor, so it moves no page.
 */
import type { Database } from 'bun:sqlite';
import { type AlertSend, type StoredSend, sendColumns, sendOf } from './alert-activity.ts';
import { type CheckEventRow, checkEventOf, type StoredCheckEvent } from './alert-checks.ts';
import {
  type EventRow,
  eventColumns,
  eventOf,
  type StoredEvent,
} from './alert-state-repository.ts';

/** Where a page starts: after the entry of this time and id. */
export interface PageCursor {
  /** The time of the entry. */
  readonly at: number;
  /** Its id. */
  readonly id: string;
}

/** The cursor before every entry: the page after it is the first. */
export const firstPage: PageCursor = { at: Number.MAX_SAFE_INTEGER, id: '' };

/** Something someone did to an alert, from the audit log. */
export interface AlertChange {
  /** The audit action, such as `alert.mute`. */
  readonly action: string;
  /** When. */
  readonly at: number;
  /** The user id of whoever did it. */
  readonly actor: string;
  /** The audit detail, parsed. */
  readonly detail: unknown;
}

/** One entry of what happened to an alert, with the id that places it. */
export type TimelineRow = { readonly id: string } & (
  | ({ readonly type: 'event' } & EventRow)
  | ({ readonly type: 'check' } & CheckEventRow)
  | ({ readonly type: 'change' } & AlertChange)
);

/** Reads the paged lists of alerts. */
export interface AlertPagesRepository {
  /**
   * What happened to an alert, after a cursor.
   *
   * @param alertId - The alert.
   * @param after - The cursor.
   * @param limit - The most to return.
   * @returns The entries, the latest first.
   */
  timeline(alertId: string, after: PageCursor, limit: number): TimelineRow[];
  /**
   * How many entries of what happened to an alert come after a cursor.
   *
   * @param alertId - The alert.
   * @param after - The cursor.
   * @returns The count.
   */
  timelineCount(alertId: string, after: PageCursor): number;
  /**
   * The messages sent about an alert, after a cursor.
   *
   * @param alertId - The alert.
   * @param after - The cursor.
   * @param limit - The most to return.
   * @returns The sends, the latest first.
   */
  sends(alertId: string, after: PageCursor, limit: number): AlertSend[];
  /**
   * How many messages sent about an alert come after a cursor.
   *
   * @param alertId - The alert.
   * @param after - The cursor.
   * @returns The count.
   */
  sendCount(alertId: string, after: PageCursor): number;
}

/** An audited change as SQLite returns it. */
interface StoredChange {
  /** Its id. */
  id: string;
  /** The action. */
  action: string;
  /** When. */
  at: number;
  /** Who. */
  actor: string;
  /** The detail, JSON. */
  detail: string | null;
}

/** The parameters of every statement: the alert, the cursor's time and its id. */
type After = [string, number, string];

/** The audited changes of one alert that the timeline shows. */
const changesOf = `audit_log WHERE target = ?1
  AND action IN ('alert.activate', 'alert.deactivate', 'alert.mute', 'alert.unmute')`;

/**
 * The SQL that keeps the rows after the cursor and puts the latest first.
 *
 * @param prefix - The table's alias with its dot, or nothing.
 * @returns The condition.
 */
function afterCursor(prefix = ''): string {
  return `(${prefix}at < ?2 OR (${prefix}at = ?2 AND ${prefix}id < ?3))`;
}

/**
 * Prepares the statements.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function pageStatements(database: Database) {
  const page = 'ORDER BY at DESC, id DESC LIMIT ?4';
  return {
    events: database.query<StoredEvent & { id: string }, [...After, number]>(
      `SELECT id, ${eventColumns} FROM alert_events WHERE alert_id = ?1 AND ${afterCursor()} ${page}`,
    ),
    checks: database.query<StoredCheckEvent & { id: string }, [...After, number]>(
      `SELECT id, kind, at, reason, notified, quiet FROM alert_check_events
       WHERE alert_id = ?1 AND ${afterCursor()} ${page}`,
    ),
    changes: database.query<StoredChange, [...After, number]>(
      `SELECT id, action, at, actor, detail FROM ${changesOf} AND ${afterCursor()} ${page}`,
    ),
    timelineCount: database.query<{ count: number }, After>(
      `SELECT (SELECT count(*) FROM alert_events WHERE alert_id = ?1 AND ${afterCursor()})
         + (SELECT count(*) FROM alert_check_events WHERE alert_id = ?1 AND ${afterCursor()})
         + (SELECT count(*) FROM ${changesOf} AND ${afterCursor()}) AS count`,
    ),
    sends: database.query<StoredSend, [...After, number]>(
      `SELECT ${sendColumns} WHERE s.alert_id = ?1 AND ${afterCursor('s.')}
       ORDER BY s.at DESC, s.id DESC LIMIT ?4`,
    ),
    sendCount: database.query<{ count: number }, After>(
      `SELECT count(*) AS count FROM notification_sends s
         JOIN notification_channels c ON c.id = s.channel_id
       WHERE s.alert_id = ?1 AND ${afterCursor('s.')}`,
    ),
  };
}

/**
 * Turns a stored audited change into an entry.
 *
 * @param stored - The stored change.
 * @returns The entry.
 */
function changeOf(stored: StoredChange): TimelineRow {
  const { detail, ...change } = stored;
  return { type: 'change', ...change, detail: detail === null ? null : JSON.parse(detail) };
}

/**
 * Orders two entries, the latest first and then the greater id.
 *
 * @param a - An entry.
 * @param b - Another.
 * @returns Negative when `a` comes first.
 */
function latestFirst(a: TimelineRow, b: TimelineRow): number {
  if (a.at !== b.at) return b.at - a.at;
  return a.id < b.id ? 1 : -1;
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createAlertPagesRepository(database: Database): AlertPagesRepository {
  const statements = pageStatements(database);
  return {
    timeline: (alertId, { at, id }, limit) => {
      const read = [alertId, at, id, limit] as const;
      const events = statements.events
        .all(...read)
        .map((stored): TimelineRow => ({ type: 'event', id: stored.id, ...eventOf(stored) }));
      const checks = statements.checks
        .all(...read)
        .map((stored): TimelineRow => ({ type: 'check', id: stored.id, ...checkEventOf(stored) }));
      const changes = statements.changes.all(...read).map(changeOf);
      return [...events, ...checks, ...changes].sort(latestFirst).slice(0, limit);
    },
    timelineCount: (alertId, { at, id }) =>
      statements.timelineCount.get(alertId, at, id)?.count ?? 0,
    sends: (alertId, { at, id }, limit) => statements.sends.all(alertId, at, id, limit).map(sendOf),
    sendCount: (alertId, { at, id }) => statements.sendCount.get(alertId, at, id)?.count ?? 0,
  };
}
