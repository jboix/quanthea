/**
 * Reads and writes the explanations of panels. An explanation is stored once and never changed
 * (the trigger in `migrations/0005-panel-explanations.sql`); asking again adds a row, and the
 * latest is the one shown.
 */
import type { Database } from 'bun:sqlite';

/** An explanation as stored, its usage parsed but not validated. */
export interface ExplanationRow {
  /** The id, a ULID. */
  readonly id: string;
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version explained. */
  readonly version: number;
  /** The panel explained. */
  readonly panelId: string;
  /** Who asked for it, by user id. */
  readonly explainedBy: string;
  /** When, in epoch milliseconds. */
  readonly explainedAt: number;
  /** The explanation. */
  readonly text: string;
  /** The tokens by model. */
  readonly usage: unknown;
  /** The tokens, all models together. */
  readonly tokens: number;
}

/** A panel of a version. */
export interface PanelKey {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The version. */
  readonly version: number;
  /** The panel. */
  readonly panelId: string;
}

/** Stores explanations. */
export interface ExplanationRepository {
  /**
   * Stores an explanation.
   *
   * @param row - The explanation.
   */
  insert(row: ExplanationRow): void;
  /**
   * Reads the latest explanation of a panel.
   *
   * @param key - The panel of a version.
   * @returns The explanation, or `undefined` when there is none.
   */
  latest(key: PanelKey): ExplanationRow | undefined;
}

/** An explanation as SQLite returns it. */
interface StoredExplanation {
  /** The id. */
  id: string;
  /** The dashboard. */
  dashboard_id: string;
  /** The version. */
  version: number;
  /** The panel. */
  panel_id: string;
  /** Who asked. */
  explained_by: string;
  /** When. */
  explained_at: number;
  /** The explanation. */
  text: string;
  /** The usage, JSON. */
  usage: string;
  /** The tokens. */
  tokens: number;
}

/** The columns of an explanation, in the order of the insert. */
const columns =
  'id, dashboard_id, version, panel_id, explained_by, explained_at, text, usage, tokens';

/**
 * Turns a stored explanation into a row.
 *
 * @param stored - The stored explanation.
 * @returns The row.
 */
function rowOf(stored: StoredExplanation): ExplanationRow {
  return {
    id: stored.id,
    dashboardId: stored.dashboard_id,
    version: stored.version,
    panelId: stored.panel_id,
    explainedBy: stored.explained_by,
    explainedAt: stored.explained_at,
    text: stored.text,
    usage: JSON.parse(stored.usage),
    tokens: stored.tokens,
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createExplanationRepository(database: Database): ExplanationRepository {
  const insert = database.query(
    `INSERT INTO panel_explanations (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const latest = database.query<StoredExplanation, [string, number, string]>(
    `SELECT ${columns} FROM panel_explanations
     WHERE dashboard_id = ? AND version = ? AND panel_id = ?
     ORDER BY explained_at DESC, id DESC LIMIT 1`,
  );
  return {
    insert: (row) => {
      const place = [row.id, row.dashboardId, row.version, row.panelId];
      const written = [row.explainedBy, row.explainedAt, row.text];
      insert.run(...place, ...written, JSON.stringify(row.usage), row.tokens);
    },
    latest: ({ dashboardId, version, panelId }) => {
      const stored = latest.get(dashboardId, version, panelId);
      return stored ? rowOf(stored) : undefined;
    },
  };
}
