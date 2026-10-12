/**
 * Reads the spec each thread works on: the latest version of its dashboard. Threads in the bin are
 * skipped.
 */
import type { Database } from 'bun:sqlite';

/** A thread with the spec it works on. */
export interface ThreadSpecRow {
  /** The thread. */
  readonly threadId: string;
  /** The latest spec of its dashboard, parsed from JSON and unchecked. */
  readonly spec: unknown;
}

/** A row as SQLite returns it. */
interface StoredThreadSpec {
  /** The thread. */
  thread_id: string;
  /** The spec's JSON. */
  spec: string;
}

/** The latest spec of each thread outside the bin whose text holds `?1`. */
const latestSpecs = `SELECT t.id AS thread_id, v.spec
  FROM threads t JOIN dashboard_versions v ON v.dashboard_id = t.dashboard_id
  WHERE t.deleted_at IS NULL AND instr(v.spec, ?1) > 0
    AND v.version = (SELECT max(version) FROM dashboard_versions WHERE dashboard_id = t.dashboard_id)`;

/**
 * Prepares the read of the specs threads work on.
 *
 * @param database - A database the migrations have run on.
 * @returns Reads the latest spec of each thread outside the bin that names a connector.
 */
export function threadSpecLister(database: Database): (connector: string) => ThreadSpecRow[] {
  const select = database.query<StoredThreadSpec, [string]>(latestSpecs);
  return (connector) =>
    select
      .all(JSON.stringify(connector))
      .map((stored) => ({ threadId: stored.thread_id, spec: JSON.parse(stored.spec) }));
}
