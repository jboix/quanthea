/**
 * Reads and writes what evaluations leave: the state of each series of an alert and the changes
 * of state, the "What happened" timeline. An evaluation is saved in one transaction.
 */
import type { Database } from 'bun:sqlite';
import type { AlertState } from '@quanthea/shared';
import {
  type CheckEventRow,
  type CheckState,
  checkStatements,
  readCheck,
  readCheckEvents,
  writeCheck,
} from './alert-checks.ts';

export type { CheckEventRow, CheckState } from './alert-checks.ts';

/** The state of a series, as stored. */
export interface SeriesRow {
  /** The series key. */
  readonly key: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** The state. */
  readonly state: AlertState;
  /** When it entered the state. */
  readonly since: number;
  /** The last value. */
  readonly value: number | null;
  /** When the result last held it. */
  readonly lastSeenAt: number;
  /** When it was last evaluated. */
  readonly evaluatedAt: number;
  /** When it last notified. */
  readonly notifiedAt: number | null;
  /** Whether it announced firing and not yet resolving. */
  readonly announced: boolean;
}

/** A change of state, as stored. */
export interface EventRow {
  /** The active version then. */
  readonly version: number;
  /** The series key. */
  readonly seriesKey: string;
  /** The labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** The state before. */
  readonly from: AlertState;
  /** The state after. */
  readonly to: AlertState;
  /** When. */
  readonly at: number;
  /** The value observed. */
  readonly value: number | null;
  /** Why the query failed. */
  readonly message: string | null;
  /** Whether it sent a notification. */
  readonly notified: boolean;
}

/** What one evaluation leaves. */
export interface EvaluationRecord {
  /** When it ran. */
  readonly evaluatedAt: number;
  /** The series it keeps, in their new state. */
  readonly series: readonly SeriesRow[];
  /** The keys of the series that are gone. */
  readonly removed: readonly string[];
  /** The changes of state, with their ids. */
  readonly events: readonly (EventRow & { readonly id: string })[];
  /** Whether the alert can be checked after it, and what happened to that, if anything. */
  readonly check?:
    | {
        readonly state: CheckState;
        readonly event: (CheckEventRow & { readonly id: string }) | null;
      }
    | undefined;
}

/** Stores the state of alerts. */
export interface AlertStateRepository {
  /**
   * The series of an alert.
   *
   * @param alertId - The alert.
   * @returns Its series, in order of their keys.
   */
  series(alertId: string): SeriesRow[];
  /**
   * How many series each alert has in each state.
   *
   * @returns The counts, by alert id and state.
   */
  stateCounts(): Map<string, Partial<Record<AlertState, number>>>;
  /**
   * The latest changes of state of an alert.
   *
   * @param alertId - The alert.
   * @param limit - The most to return.
   * @returns The changes, the latest first.
   */
  events(alertId: string, limit: number): EventRow[];
  /**
   * Whether an alert can be checked.
   *
   * @param alertId - The alert.
   * @returns The failed evaluations in a row, since when it is in error, and whether it said so.
   */
  checkState(alertId: string): CheckState;
  /**
   * The latest times an alert went into error or could be checked again.
   *
   * @param alertId - The alert.
   * @param limit - The most to return.
   * @returns The events, the latest first.
   */
  checkEvents(alertId: string, limit: number): CheckEventRow[];
  /**
   * Saves an evaluation: the series' new states, the series gone, the changes and the time.
   *
   * @param alertId - The alert.
   * @param record - What the evaluation left.
   */
  saveEvaluation(alertId: string, record: EvaluationRecord): void;
  /**
   * Deletes the changes of state, and the check events, older than a time.
   *
   * @param before - The time.
   * @returns How many it deleted.
   */
  purgeEvents(before: number): number;
}

/** A series as SQLite returns it. */
interface StoredSeries {
  /** The key. */
  series_key: string;
  /** The labels, JSON. */
  labels: string;
  /** The state. */
  state: AlertState;
  /** Since. */
  since: number;
  /** The value. */
  value: number | null;
  /** Last seen. */
  last_seen_at: number;
  /** Last evaluated. */
  evaluated_at: number;
  /** Last notified. */
  notified_at: number | null;
  /** 0 or 1. */
  announced: number;
}

/** A change of state as SQLite returns it. */
interface StoredEvent {
  /** The version. */
  version: number;
  /** The key. */
  series_key: string;
  /** The labels, JSON. */
  labels: string;
  /** Before. */
  from_state: AlertState;
  /** After. */
  to_state: AlertState;
  /** When. */
  at: number;
  /** The value. */
  value: number | null;
  /** The message. */
  message: string | null;
  /** 0 or 1. */
  notified: number;
}

/**
 * Prepares the statements.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function stateStatements(database: Database) {
  return {
    series: database.query<StoredSeries, [string]>(
      `SELECT series_key, labels, state, since, value, last_seen_at, evaluated_at, notified_at,
         announced FROM alert_series WHERE alert_id = ? ORDER BY series_key`,
    ),
    counts: database.query<{ alert_id: string; state: AlertState; count: number }, []>(
      'SELECT alert_id, state, count(*) AS count FROM alert_series GROUP BY alert_id, state',
    ),
    events: database.query<StoredEvent, [string, number]>(
      `SELECT version, series_key, labels, from_state, to_state, at, value, message, notified
       FROM alert_events WHERE alert_id = ? ORDER BY at DESC, id DESC LIMIT ?`,
    ),
    upsert: database.query(
      `INSERT INTO alert_series (alert_id, series_key, labels, state, since, value, last_seen_at,
         evaluated_at, notified_at, announced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (alert_id, series_key) DO UPDATE SET labels = excluded.labels,
         state = excluded.state, since = excluded.since, value = excluded.value,
         last_seen_at = excluded.last_seen_at, evaluated_at = excluded.evaluated_at,
         notified_at = excluded.notified_at, announced = excluded.announced`,
    ),
    remove: database.query('DELETE FROM alert_series WHERE alert_id = ? AND series_key = ?'),
    insertEvent: database.query(
      `INSERT INTO alert_events (id, alert_id, version, series_key, labels, from_state, to_state,
         at, value, message, notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    evaluated: database.query('UPDATE alerts SET evaluated_at = ? WHERE id = ?'),
    purge: database.query('DELETE FROM alert_events WHERE at < ?'),
  };
}

/**
 * Turns a stored series into a row.
 *
 * @param stored - The stored series.
 * @returns The row.
 */
function seriesOf(stored: StoredSeries): SeriesRow {
  return {
    key: stored.series_key,
    labels: JSON.parse(stored.labels),
    state: stored.state,
    since: stored.since,
    value: stored.value,
    lastSeenAt: stored.last_seen_at,
    evaluatedAt: stored.evaluated_at,
    notifiedAt: stored.notified_at,
    announced: stored.announced === 1,
  };
}

/**
 * Turns a stored change of state into a row.
 *
 * @param stored - The stored change.
 * @returns The row.
 */
function eventOf(stored: StoredEvent): EventRow {
  return {
    version: stored.version,
    seriesKey: stored.series_key,
    labels: JSON.parse(stored.labels),
    from: stored.from_state,
    to: stored.to_state,
    at: stored.at,
    value: stored.value,
    message: stored.message,
    notified: stored.notified === 1,
  };
}

/**
 * Builds the transaction that saves an evaluation.
 *
 * @param database - A database the migrations have run on.
 * @param statements - The prepared statements.
 * @returns The method.
 */
function evaluationSaver(
  database: Database,
  statements: ReturnType<typeof stateStatements>,
  checks: ReturnType<typeof checkStatements>,
): AlertStateRepository['saveEvaluation'] {
  const upsert = (alertId: string, row: SeriesRow) => {
    const timing = [row.since, row.value, row.lastSeenAt, row.evaluatedAt, row.notifiedAt];
    const labels = JSON.stringify(row.labels);
    statements.upsert.run(alertId, row.key, labels, row.state, ...timing, Number(row.announced));
  };
  const insert = (alertId: string, event: EvaluationRecord['events'][number]) => {
    const place = [event.id, alertId, event.version, event.seriesKey, JSON.stringify(event.labels)];
    const change = [event.from, event.to, event.at, event.value, event.message];
    statements.insertEvent.run(...place, ...change, Number(event.notified));
  };
  return database.transaction((alertId: string, record: EvaluationRecord) => {
    for (const row of record.series) upsert(alertId, row);
    for (const key of record.removed) statements.remove.run(alertId, key);
    for (const event of record.events) insert(alertId, event);
    if (record.check) writeCheck(checks, alertId, record.check.state, record.check.event);
    statements.evaluated.run(record.evaluatedAt, alertId);
  });
}

/**
 * Counts series by alert and state.
 *
 * @param statements - The prepared statements.
 * @returns The counts.
 */
function counter(statements: ReturnType<typeof stateStatements>) {
  return () => {
    const counts = new Map<string, Partial<Record<AlertState, number>>>();
    for (const row of statements.counts.all())
      counts.set(row.alert_id, { ...counts.get(row.alert_id), [row.state]: row.count });
    return counts;
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createAlertStateRepository(database: Database): AlertStateRepository {
  const statements = stateStatements(database);
  const checks = checkStatements(database);
  return {
    series: (alertId) => statements.series.all(alertId).map(seriesOf),
    stateCounts: counter(statements),
    events: (alertId, limit) => statements.events.all(alertId, limit).map(eventOf),
    checkState: (alertId) => readCheck(checks, alertId),
    checkEvents: (alertId, limit) => readCheckEvents(checks, alertId, limit),
    saveEvaluation: evaluationSaver(database, statements, checks),
    purgeEvents: (before) =>
      statements.purge.run(before).changes + checks.purge.run(before).changes,
  };
}
