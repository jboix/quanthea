/**
 * Reads the access records the agent stores in threads: one `data-sourceAccess` part per
 * connector and access a run read, inside the messages' parts. Threads in the bin are skipped.
 */
import type { Database } from 'bun:sqlite';

/** An access record with its thread. */
export interface SourceAccessRow {
  /** The thread. */
  readonly threadId: string;
  /** The record, parsed from JSON and unchecked. */
  readonly access: unknown;
}

/** A row as SQLite returns it. */
interface StoredRecord {
  /** The thread. */
  thread_id: string;
  /** The record's JSON. */
  access: string;
}

/** The records of the threads outside the bin; `?1` is a thread id, or null for every thread. */
const recordsQuery = `SELECT m.thread_id, json_extract(part.value, '$.data') AS access
  FROM messages m JOIN threads t ON t.id = m.thread_id AND t.deleted_at IS NULL,
    json_each(m.parts) part
  WHERE (?1 IS NULL OR m.thread_id = ?1)
    AND m.parts LIKE '%"data-sourceAccess"%'
    AND json_extract(part.value, '$.type') = 'data-sourceAccess'`;

/**
 * Turns a stored row into a record, skipping one whose JSON does not parse.
 *
 * @param stored - The row.
 * @returns The record, or nothing.
 */
function toRecord(stored: StoredRecord): SourceAccessRow[] {
  try {
    return [{ threadId: stored.thread_id, access: JSON.parse(stored.access) }];
  } catch {
    return [];
  }
}

/**
 * Prepares the read of the access records.
 *
 * @param database - A database the migrations have run on.
 * @returns Reads the records of one thread, or of every thread outside the bin.
 */
export function sourceAccessReads(database: Database): (threadId?: string) => SourceAccessRow[] {
  const select = database.query<StoredRecord, [string | null]>(recordsQuery);
  return (threadId) => select.all(threadId ?? null).flatMap(toRecord);
}
