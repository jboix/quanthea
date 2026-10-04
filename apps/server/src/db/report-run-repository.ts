/**
 * Reads and writes report runs. A run changes only while it is running; once it succeeded or
 * failed, triggers refuse to rewrite it, but for recording once when its message went out.
 */
import type { Database } from 'bun:sqlite';

/** What started a run. */
export type RunKind = 'schedule' | 'manual';

/** A run's status. */
export type RunStatus = 'running' | 'ok' | 'failed';

/** A window, in epoch milliseconds, both ends included. */
export interface RunRange {
  /** The first instant. */
  readonly from: number;
  /** The last instant. */
  readonly to: number;
}

/** A run without its results, as stored. */
export interface RunSummaryRow {
  /** The id. */
  readonly id: string;
  /** The report. */
  readonly reportId: string;
  /** The version it runs. */
  readonly version: number;
  /** What started it. */
  readonly kind: RunKind;
  /** The schedule's time it runs for; `null` for a run by hand. */
  readonly scheduledAt: number | null;
  /** The period. */
  readonly period: RunRange;
  /** The period it compares with. */
  readonly comparison: RunRange | null;
  /** Its status. */
  readonly status: RunStatus;
  /** The attempts made. */
  readonly attempts: number;
  /** When it tries again. */
  readonly retryAt: number | null;
  /** Why the last attempt failed. */
  readonly error: string | null;
  /** The headline numbers, parsed from JSON but not validated. */
  readonly headlines: unknown;
  /** Whether its outcome goes to the channels. */
  readonly notify: boolean;
  /** Who ran it by hand. */
  readonly startedBy: string | null;
  /** When it was made. */
  readonly createdAt: number;
  /** When the last attempt ended. */
  readonly ranAt: number | null;
  /** When its message went out. */
  readonly sentAt: number | null;
}

/** A run with its results, as stored. */
export interface RunRow extends RunSummaryRow {
  /** The variable values, parsed from JSON but not validated. */
  readonly variables: unknown;
  /** Each panel's run over the period, parsed from JSON, or `null`. */
  readonly panels: unknown;
  /** Each panel's run over the comparison period, parsed from JSON, or `null`. */
  readonly comparisonPanels: unknown;
  /** Each channel's result, parsed from JSON, or `null`. */
  readonly delivery: unknown;
}

/** A run to store. */
export type NewRun = Pick<
  RunSummaryRow,
  'id' | 'reportId' | 'version' | 'kind' | 'scheduledAt' | 'period' | 'comparison'
> &
  Pick<RunSummaryRow, 'notify' | 'startedBy' | 'createdAt'> & {
    /** The variable values. */
    readonly variables: unknown;
  };

/** A successful attempt's results, as JSON. */
export interface RunResults {
  /** Each panel's run over the period. */
  readonly panels: string;
  /** Each panel's run over the comparison period, or `null`. */
  readonly comparison: string | null;
  /** The headline numbers. */
  readonly headlines: string;
  /** The size of the results, in bytes. */
  readonly bytes: number;
}

/** Stores report runs. */
export interface ReportRunRepository {
  /**
   * Stores a new run, running.
   *
   * @param run - The run.
   * @returns `false` when the schedule already made a run for that time.
   */
  insert(run: NewRun): boolean;
  /**
   * Counts an attempt starting.
   *
   * @param id - The run.
   * @returns The attempts made, this one included.
   */
  startAttempt(id: string): number;
  /**
   * Records a failed attempt that tries again later.
   *
   * @param id - The run.
   * @param error - Why it failed.
   * @param at - When it ended.
   * @param retryAt - When it tries again.
   */
  retryLater(id: string, error: string, at: number, retryAt: number): void;
  /**
   * Records a failure after the last attempt.
   *
   * @param id - The run.
   * @param error - Why it failed.
   * @param at - When it ended.
   */
  fail(id: string, error: string, at: number): void;
  /**
   * Records a success with its results.
   *
   * @param id - The run.
   * @param results - The frozen results.
   * @param at - When it ended.
   */
  succeed(id: string, results: RunResults, at: number): void;
  /**
   * Records when the message went out, once.
   *
   * @param id - The run.
   * @param at - When.
   * @param delivery - Each channel's result.
   */
  markSent(id: string, at: number, delivery: unknown): void;
  /**
   * Reads a run with its results.
   *
   * @param id - The run.
   * @returns The run, or `undefined`.
   */
  get(id: string): RunRow | undefined;
  /**
   * Lists a report's runs, the latest period first.
   *
   * @param reportId - The report.
   * @param options - Only runs of these versions (all when `null`), whose period starts before an
   *   instant, at most so many.
   * @returns The runs.
   */
  list(reportId: string, options: ListOptions): RunSummaryRow[];
  /**
   * The runs of the periods either side of one.
   *
   * @param reportId - The report.
   * @param periodFrom - The period's start.
   * @param versions - Only runs of these versions; all when `null`.
   * @returns The run before and the run after, when there are.
   */
  neighbours(
    reportId: string,
    periodFrom: number,
    versions: readonly number[] | null,
  ): { previous: RunSummaryRow | undefined; next: RunSummaryRow | undefined };
  /**
   * Lists the running runs: those due to try again, and those no attempt is making.
   *
   * @param now - The current instant.
   * @returns The runs whose retry is due or which wait for no retry.
   */
  pending(now: number): RunSummaryRow[];
  /**
   * Deletes the finished runs made before an instant.
   *
   * @param before - The instant.
   * @returns How many were deleted.
   */
  purgeBefore(before: number): number;
}

/** How a list of runs is narrowed. */
export interface ListOptions {
  /** Only runs of these versions; all when `null`. */
  readonly versions: readonly number[] | null;
  /** Only runs whose period starts before this instant. */
  readonly before?: number | undefined;
  /** At most this many. */
  readonly limit: number;
}

/** A run as SQLite returns it. */
interface StoredRun {
  /** The id. */
  id: string;
  /** The report. */
  report_id: string;
  /** The version. */
  version: number;
  /** What started it. */
  kind: RunKind;
  /** The schedule's time. */
  scheduled_at: number | null;
  /** The period's start. */
  period_from: number;
  /** The period's end. */
  period_to: number;
  /** The comparison's start. */
  compare_from: number | null;
  /** The comparison's end. */
  compare_to: number | null;
  /** The status. */
  status: RunStatus;
  /** The attempts. */
  attempts: number;
  /** When it tries again. */
  retry_at: number | null;
  /** The failure. */
  error: string | null;
  /** JSON. */
  variables: string;
  /** JSON or NULL. */
  panels: string | null;
  /** JSON or NULL. */
  comparison: string | null;
  /** JSON. */
  headlines: string;
  /** 1 when it notifies. */
  notify: number;
  /** Who ran it by hand. */
  started_by: string | null;
  /** When made. */
  created_at: number;
  /** When it ran. */
  ran_at: number | null;
  /** When sent. */
  sent_at: number | null;
  /** JSON or NULL. */
  delivery: string | null;
}

/** The columns of a run without its results. */
const summaryColumns = `id, report_id, version, kind, scheduled_at, period_from, period_to,
  compare_from, compare_to, status, attempts, retry_at, error, headlines, notify, started_by,
  created_at, ran_at, sent_at`;

/** Keeps a run of the versions given, all when the list is `NULL`. */
const versionFilter = '(?2 IS NULL OR version IN (SELECT value FROM json_each(?2)))';

/**
 * Parses JSON that may be missing.
 *
 * @param text - The JSON, or `null`.
 * @returns The value, or `null`.
 */
function parsed(text: string | null): unknown {
  return text === null ? null : JSON.parse(text);
}

/**
 * Turns a stored run into a summary.
 *
 * @param stored - The stored run, at least its summary columns.
 * @returns The summary.
 */
function summaryOf(stored: Omit<StoredRun, 'variables' | 'panels' | 'comparison' | 'delivery'>) {
  const { compare_from: from, compare_to: to } = stored;
  return {
    id: stored.id,
    reportId: stored.report_id,
    version: stored.version,
    kind: stored.kind,
    scheduledAt: stored.scheduled_at,
    period: { from: stored.period_from, to: stored.period_to },
    comparison: from === null || to === null ? null : { from, to },
    status: stored.status,
    attempts: stored.attempts,
    retryAt: stored.retry_at,
    error: stored.error,
    headlines: JSON.parse(stored.headlines),
    notify: stored.notify === 1,
    startedBy: stored.started_by,
    createdAt: stored.created_at,
    ranAt: stored.ran_at,
    sentAt: stored.sent_at,
  } satisfies RunSummaryRow;
}

/**
 * Turns a stored run into a row with its results.
 *
 * @param stored - The stored run.
 * @returns The row.
 */
function runOf(stored: StoredRun): RunRow {
  return {
    ...summaryOf(stored),
    variables: JSON.parse(stored.variables),
    panels: parsed(stored.panels),
    comparisonPanels: parsed(stored.comparison),
    delivery: parsed(stored.delivery),
  };
}

/**
 * Prepares the statements that read.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function readStatements(database: Database) {
  type Summary = Omit<StoredRun, 'variables' | 'panels' | 'comparison' | 'delivery'>;
  const ordered = 'ORDER BY period_from DESC, created_at DESC, id DESC';
  return {
    get: database.query<StoredRun, [string]>('SELECT * FROM report_runs WHERE id = ?'),
    list: database.query<Summary, [string, string | null, number, number]>(
      `SELECT ${summaryColumns} FROM report_runs WHERE report_id = ?1 AND ${versionFilter}
         AND period_from < ?3 ${ordered} LIMIT ?4`,
    ),
    previous: database.query<Summary, [string, string | null, number]>(
      `SELECT ${summaryColumns} FROM report_runs WHERE report_id = ?1 AND ${versionFilter}
         AND period_from < ?3 ${ordered} LIMIT 1`,
    ),
    next: database.query<Summary, [string, string | null, number]>(
      `SELECT ${summaryColumns} FROM report_runs WHERE report_id = ?1 AND ${versionFilter}
         AND period_from > ?3 ORDER BY period_from, created_at DESC, id DESC LIMIT 1`,
    ),
    pending: database.query<Summary, [number]>(
      `SELECT ${summaryColumns} FROM report_runs
       WHERE status = 'running' AND (retry_at IS NULL OR retry_at <= ?) ORDER BY created_at, id`,
    ),
  };
}

/**
 * Prepares the statements that write.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function writeStatements(database: Database) {
  const running = "WHERE id = ? AND status = 'running'";
  return {
    insert: database.query(
      `INSERT INTO report_runs (id, report_id, version, kind, scheduled_at, period_from,
         period_to, compare_from, compare_to, status, variables, notify, started_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    ),
    startAttempt: database.query<{ attempts: number }, [string]>(
      `UPDATE report_runs SET attempts = attempts + 1, retry_at = NULL ${running}
       RETURNING attempts`,
    ),
    retryLater: database.query(
      `UPDATE report_runs SET error = ?, ran_at = ?, retry_at = ? ${running}`,
    ),
    fail: database.query(
      `UPDATE report_runs SET status = 'failed', error = ?, ran_at = ?, retry_at = NULL ${running}`,
    ),
    succeed: database.query(
      `UPDATE report_runs SET status = 'ok', error = NULL, retry_at = NULL, panels = ?,
         comparison = ?, headlines = ?, bytes = ?, ran_at = ? ${running}`,
    ),
    markSent: database.query(
      'UPDATE report_runs SET sent_at = ?, delivery = ? WHERE id = ? AND sent_at IS NULL',
    ),
    purge: database.query("DELETE FROM report_runs WHERE created_at < ? AND status <> 'running'"),
  };
}

/**
 * The values of a new run's insert, in column order.
 *
 * @param run - The run.
 * @returns The values.
 */
function insertValues(run: NewRun) {
  const { id, reportId, version, kind, scheduledAt, period, comparison } = run;
  const compared = [comparison?.from ?? null, comparison?.to ?? null];
  const rest = [JSON.stringify(run.variables), run.notify ? 1 : 0, run.startedBy, run.createdAt];
  return [id, reportId, version, kind, scheduledAt, period.from, period.to, ...compared, ...rest];
}

/**
 * The read methods.
 *
 * @param database - A database the migrations have run on.
 * @returns The methods.
 */
function readMethods(
  database: Database,
): Pick<ReportRunRepository, 'get' | 'list' | 'neighbours' | 'pending'> {
  const read = readStatements(database);
  const versionsOf = (versions: readonly number[] | null) =>
    versions === null ? null : JSON.stringify(versions);
  return {
    get: (id) => {
      const stored = read.get.get(id);
      return stored ? runOf(stored) : undefined;
    },
    list: (reportId, { versions, before, limit }) =>
      read.list
        .all(reportId, versionsOf(versions), before ?? Number.MAX_SAFE_INTEGER, limit)
        .map(summaryOf),
    neighbours: (reportId, periodFrom, versions) => {
      const previous = read.previous.get(reportId, versionsOf(versions), periodFrom);
      const next = read.next.get(reportId, versionsOf(versions), periodFrom);
      return {
        previous: previous ? summaryOf(previous) : undefined,
        next: next ? summaryOf(next) : undefined,
      };
    },
    pending: (now) => read.pending.all(now).map(summaryOf),
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createReportRunRepository(database: Database): ReportRunRepository {
  const write = writeStatements(database);
  return {
    ...readMethods(database),
    insert: (run) => write.insert.run(...insertValues(run)).changes > 0,
    startAttempt: (id) => write.startAttempt.get(id)?.attempts ?? 0,
    retryLater: (id, error, at, retryAt) => {
      write.retryLater.run(error, at, retryAt, id);
    },
    fail: (id, error, at) => {
      write.fail.run(error, at, id);
    },
    succeed: (id, results, at) => {
      const { panels, comparison, headlines, bytes } = results;
      write.succeed.run(panels, comparison, headlines, bytes, at, id);
    },
    markSent: (id, at, delivery) => {
      write.markSent.run(at, JSON.stringify(delivery), id);
    },
    purgeBefore: (before) => write.purge.run(before).changes,
  };
}
