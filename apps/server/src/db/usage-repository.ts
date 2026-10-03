/** Reads and writes the usage ledger. */
import type { Database } from 'bun:sqlite';
import type { UsageBucket } from '@quanthea/shared';

/** What an event of the ledger is: a model step, or a view of a pinned dashboard or a snapshot. */
export type UsageKind = 'model' | 'pinned_view' | 'snapshot_view';

/** The feature a model step served, or `null` for a view. */
export type UsageFeature = UsageBucket['feature'];

/** One event of the ledger. */
export interface UsageEventRow {
  /** The id. */
  readonly id: string;
  /** When it happened, epoch milliseconds. */
  readonly at: number;
  /** A model step, or a view of a pinned dashboard or of a snapshot. */
  readonly kind: UsageKind;
  /** The thread, for a model step. */
  readonly threadId: string | null;
  /** The dashboard, for a view, or a model step about one outside a thread. */
  readonly dashboardId: string | null;
  /** Who a model step outside a thread ran for; a thread's steps name its owner instead. */
  readonly userId: string | null;
  /** The provider, for a model step. */
  readonly provider: string | null;
  /** The model id, for a model step. */
  readonly model: string | null;
  /** The job, such as `plan` or `build`, for a model step. */
  readonly job: string | null;
  /** The feature a model step served, such as building dashboards; `null` for a view. */
  readonly feature: UsageFeature;
  /** Fresh input tokens. */
  readonly input: number;
  /** Input tokens read from the cache. */
  readonly cachedInput: number;
  /** Input tokens written to the cache. */
  readonly cacheWrite: number;
  /** Output tokens. */
  readonly output: number;
  /** The list price at the time, in millionths of a dollar, or `null` when unknown. */
  readonly costMicros: number | null;
}

/** The events of one hour, one kind, one model, one feature and one user, added up. */
export interface UsageBucketRow {
  /** The hour, as epoch milliseconds of its start. */
  readonly hour: number;
  /** The kind. */
  readonly kind: UsageKind;
  /** The provider, empty for a pinned view. */
  readonly provider: string;
  /** The model, empty for a pinned view. */
  readonly model: string;
  /** The feature the steps served; `null` for views. */
  readonly feature: UsageFeature;
  /** Who the steps ran for: their thread's owner; empty outside a thread and for pinned views. */
  readonly userId: string;
  /** Fresh input tokens. */
  readonly input: number;
  /** Cache reads. */
  readonly cachedInput: number;
  /** Cache writes. */
  readonly cacheWrite: number;
  /** Output tokens. */
  readonly output: number;
  /** The priced cost, in millionths of a dollar. */
  readonly costMicros: number;
  /** How many events. */
  readonly events: number;
  /** How many model steps had no price. */
  readonly unpriced: number;
}

/** The ledger. */
export interface UsageRepository {
  /**
   * Records an event.
   *
   * @param event - The event.
   */
  record(event: UsageEventRow): void;
  /**
   * The events of a time range, added up by hour, kind, model, feature and user.
   *
   * @param from - The start, epoch milliseconds, included.
   * @param to - The end, excluded.
   * @returns The buckets, oldest first.
   */
  buckets(from: number, to: number): UsageBucketRow[];
  /**
   * How many threads spent tokens since a time.
   *
   * @param since - Epoch milliseconds.
   * @returns The count.
   */
  threadsSince(since: number): number;
}

/**
 * Prepares the insert of an event.
 *
 * @param database - A database the migrations have run on.
 * @returns Records one event.
 */
function recorder(database: Database): (event: UsageEventRow) => void {
  const insert = database.query(
    `INSERT INTO usage_events (id, at, kind, thread_id, dashboard_id, provider, model, job,
       feature, input, cached_input, cache_write, output, cost_micros, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       coalesce(?, (SELECT created_by FROM threads WHERE id = ?)))`,
  );
  return (event) => {
    const { id, at, kind, threadId, dashboardId, provider, model, job, feature } = event;
    const { input, cachedInput, cacheWrite, output, costMicros, userId } = event;
    const names = [id, at, kind, threadId, dashboardId, provider, model, job, feature];
    insert.run(...names, input, cachedInput, cacheWrite, output, costMicros, userId, threadId);
  };
}

/**
 * Creates the ledger over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createUsageRepository(database: Database): UsageRepository {
  const select = database.query<UsageBucketRow, [number, number]>(
    `SELECT (at / 3600000) * 3600000 AS hour, kind, coalesce(provider, '') AS provider,
       coalesce(model, '') AS model, feature, coalesce(user_id, '') AS userId, sum(input) AS input,
       sum(cached_input) AS cachedInput,
       sum(cache_write) AS cacheWrite, sum(output) AS output,
       coalesce(sum(cost_micros), 0) AS costMicros, count(*) AS events,
       sum(kind = 'model' AND cost_micros IS NULL) AS unpriced
     FROM usage_events WHERE at >= ? AND at < ?
     GROUP BY hour, kind, provider, model, feature, userId
     ORDER BY hour, kind, provider, model, feature, userId`,
  );
  const threads = database.query<{ count: number }, [number]>(
    `SELECT count(DISTINCT thread_id) AS count FROM usage_events WHERE kind = 'model' AND at >= ?`,
  );
  return {
    record: recorder(database),
    buckets: (from, to) => select.all(from, to),
    threadsSince: (since) => threads.get(since)?.count ?? 0,
  };
}
