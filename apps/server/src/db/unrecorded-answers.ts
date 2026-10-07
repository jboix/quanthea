/**
 * Reads and amends the answers stored before runs recorded the access they read data at: the
 * assistant messages with tool parts and no `data-sourceAccess` part.
 */
import type { Database } from 'bun:sqlite';

/** A stored answer, with its parts parsed and unchecked. */
export interface UnrecordedAnswer {
  /** The message id. */
  readonly id: string;
  /** The parts, as the AI SDK stored them. */
  readonly parts: readonly unknown[];
}

/** The reads and writes of the answers without an access record. */
export interface UnrecordedAnswers {
  /**
   * Reads the answers stored with tool parts and no access record, in any thread.
   *
   * @returns The answers, with their parts.
   */
  unrecordedAnswers(): UnrecordedAnswer[];
  /**
   * Replaces an answer's parts, to add the access records it lacked.
   *
   * @param id - The message id.
   * @param parts - The parts, the old ones first.
   */
  amendParts(id: string, parts: readonly unknown[]): void;
}

/** A row as SQLite returns it. */
interface StoredAnswer {
  /** The message id. */
  id: string;
  /** The parts' JSON. */
  parts: string;
}

/**
 * Turns a stored row into an answer, skipping one whose parts are not a JSON array.
 *
 * @param stored - The row.
 * @returns The answer, or nothing.
 */
function toAnswer(stored: StoredAnswer): UnrecordedAnswer[] {
  try {
    const parts: unknown = JSON.parse(stored.parts);
    return Array.isArray(parts) ? [{ id: stored.id, parts }] : [];
  } catch {
    return [];
  }
}

/**
 * Prepares the read and the amendment of the answers without an access record.
 *
 * @param database - A database the migrations have run on.
 * @returns Reads them, and adds parts to one.
 */
export function unrecordedAnswers(database: Database): UnrecordedAnswers {
  const select = database.query<StoredAnswer, []>(
    `SELECT id, parts FROM messages WHERE role = 'assistant' AND parts LIKE '%"tool-%'
       AND parts NOT LIKE '%"data-sourceAccess"%'`,
  );
  const update = database.query('UPDATE messages SET parts = ? WHERE id = ?');
  return {
    unrecordedAnswers: () => select.all().flatMap(toAnswer),
    amendParts: (id, parts) => {
      update.run(JSON.stringify(parts), id);
    },
  };
}
