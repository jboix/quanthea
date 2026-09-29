/**
 * Full-text search over the library: pinned dashboards outside the bin and their panels, kept up
 * to date by the triggers in `migrations/0008-library-search.sql`.
 */
import type { Database } from 'bun:sqlite';

/** A dashboard or a panel that matches a search, with its BM25 rank: lower is better. */
export interface LibraryHit {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The panel, or `null` when the dashboard itself matches. */
  readonly panelId: string | null;
  /** The rank. */
  readonly rank: number;
}

/** The library searches. */
export interface LibrarySearcher {
  /**
   * The dashboards and panels whose text, with its context, matches every word.
   *
   * @param words - The words, each matched as a prefix.
   * @returns The hits, the best first.
   */
  matchAll(words: readonly string[]): LibraryHit[];
  /**
   * The panels whose own title, description or queries match any of the words.
   *
   * @param words - The words, each matched as a prefix.
   * @returns The hits, the best first.
   */
  panelsMatchingAny(words: readonly string[]): LibraryHit[];
}

/** A hit as SQLite returns it. */
interface StoredHit {
  /** The dashboard. */
  dashboard_id: string;
  /** The panel. */
  panel_id: string | null;
  /** The rank. */
  rank: number;
}

/**
 * The FTS5 phrase of a word, matched as a prefix. Quoting keeps FTS5 syntax out of the search.
 *
 * @param word - A word of letters and digits.
 * @returns The phrase.
 */
function prefixOf(word: string): string {
  return `"${word.replaceAll('"', '')}"*`;
}

/**
 * Prepares the library searches. Titles weigh most, then tags, descriptions and queries; the
 * context of a document weighs least.
 *
 * @param database - A database the migrations have run on.
 * @returns The searches.
 */
export function librarySearcher(database: Database): LibrarySearcher {
  const select = database.query<StoredHit, [string]>(
    `SELECT dashboard_id, panel_id, bm25(library_fts, 0, 0, 10, 4, 6, 2, 1) AS rank
     FROM library_fts WHERE library_fts MATCH ? ORDER BY rank LIMIT 500`,
  );
  const toHit = (row: StoredHit): LibraryHit => ({
    dashboardId: row.dashboard_id,
    panelId: row.panel_id,
    rank: row.rank,
  });
  return {
    matchAll: (words) =>
      words.length === 0 ? [] : select.all(words.map(prefixOf).join(' ')).map(toHit),
    panelsMatchingAny: (words) => {
      if (words.length === 0) return [];
      const match = `{title description queries} : (${words.map(prefixOf).join(' OR ')})`;
      return select.all(match).flatMap((row) => (row.panel_id === null ? [] : [toHit(row)]));
    },
  };
}
