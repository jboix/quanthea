/**
 * Reads and writes the links between alerts and dashboard panels, the suggestions editors
 * dismissed, and the changes of state that start and end each firing period. Links and dismissals
 * go with their alert or their dashboard (`ON DELETE CASCADE`).
 */
import type { Database } from 'bun:sqlite';
import type { AlertLinkHow } from '@quanthea/shared';

/** A panel of a dashboard, by id: links follow it from version to version. */
export interface LinkedPanel {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The panel. */
  readonly panelId: string;
}

/** A link between an alert and a panel. */
export interface AlertLinkRow extends LinkedPanel {
  /** The alert. */
  readonly alertId: string;
  /** Who made it, by user id. */
  readonly createdBy: string;
  /** When. */
  readonly createdAt: number;
  /** How it was made. */
  readonly how: AlertLinkHow;
}

/** A suggestion an editor dismissed. */
export interface DismissalRow extends LinkedPanel {
  /** The alert. */
  readonly alertId: string;
}

/** A change of state into or out of firing. */
export interface FiringChange {
  /** The series key. */
  readonly seriesKey: string;
  /** The series' labels. */
  readonly labels: Readonly<Record<string, string>>;
  /** Whether the series started firing; otherwise it stopped. */
  readonly started: boolean;
  /** When. */
  readonly at: number;
}

/** Stores links and dismissals. */
export interface AlertLinkRepository {
  /**
   * Adds a link; a link that exists stays as it was.
   *
   * @param row - The link.
   * @returns Whether it was added.
   */
  add(row: AlertLinkRow): boolean;
  /**
   * Removes a link.
   *
   * @param alertId - The alert.
   * @param panel - The panel.
   * @returns Whether there was one.
   */
  remove(alertId: string, panel: LinkedPanel): boolean;
  /**
   * The links of an alert.
   *
   * @param alertId - The alert.
   * @returns The links, the oldest first.
   */
  forAlert(alertId: string): AlertLinkRow[];
  /**
   * The links to a dashboard's panels.
   *
   * @param dashboardId - The dashboard.
   * @returns The links, the oldest first.
   */
  forDashboard(dashboardId: string): AlertLinkRow[];
  /**
   * Every link, to leave linked pairs out of the suggestions.
   *
   * @returns The links.
   */
  all(): AlertLinkRow[];
  /**
   * Remembers that an editor dismissed a suggestion.
   *
   * @param row - The alert and the panel.
   * @param by - Who dismissed it.
   * @param at - When.
   */
  dismiss(row: DismissalRow, by: string, at: number): void;
  /**
   * Every dismissed suggestion.
   *
   * @returns The dismissals.
   */
  dismissals(): DismissalRow[];
  /**
   * The changes into and out of firing of an alert's series, up to a time.
   *
   * @param alertId - The alert.
   * @param until - The latest time.
   * @returns The changes, the oldest first.
   */
  firingChanges(alertId: string, until: number): FiringChange[];
}

/** A link as SQLite returns it. */
interface StoredLink {
  /** The alert. */
  alert_id: string;
  /** The dashboard. */
  dashboard_id: string;
  /** The panel. */
  panel_id: string;
  /** Who made it. */
  created_by: string;
  /** When. */
  created_at: number;
  /** How. */
  how: AlertLinkHow;
}

/** A change of state as SQLite returns it, for firing periods. */
interface StoredChange {
  /** The series key. */
  series_key: string;
  /** The labels, JSON. */
  labels: string;
  /** The state it entered. */
  to_state: string;
  /** When. */
  at: number;
}

/** The columns of a link. */
const linkColumns = 'alert_id, dashboard_id, panel_id, created_by, created_at, how';

/**
 * Prepares the statements.
 *
 * @param database - A database the migrations have run on.
 * @returns The statements.
 */
function linkStatements(database: Database) {
  return {
    add: database.query(
      `INSERT INTO alert_links (${linkColumns}) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    ),
    remove: database.query(
      'DELETE FROM alert_links WHERE alert_id = ? AND dashboard_id = ? AND panel_id = ?',
    ),
    forAlert: database.query<StoredLink, [string]>(
      `SELECT ${linkColumns} FROM alert_links WHERE alert_id = ? ORDER BY created_at, panel_id`,
    ),
    forDashboard: database.query<StoredLink, [string]>(
      `SELECT ${linkColumns} FROM alert_links WHERE dashboard_id = ? ORDER BY created_at, alert_id`,
    ),
    all: database.query<StoredLink, []>(`SELECT ${linkColumns} FROM alert_links`),
    dismiss: database.query(
      `INSERT INTO alert_link_dismissals (alert_id, dashboard_id, panel_id, dismissed_by,
         dismissed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    ),
    dismissals: database.query<Omit<StoredLink, 'created_by' | 'created_at' | 'how'>, []>(
      'SELECT alert_id, dashboard_id, panel_id FROM alert_link_dismissals',
    ),
    firing: database.query<StoredChange, [string, number]>(
      `SELECT series_key, labels, to_state, at FROM alert_events
       WHERE alert_id = ? AND at <= ? AND (from_state = 'firing' OR to_state = 'firing')
       ORDER BY at, id`,
    ),
  };
}

/**
 * Turns a stored link into a row.
 *
 * @param stored - The stored link.
 * @returns The row.
 */
function linkOf(stored: StoredLink): AlertLinkRow {
  return {
    alertId: stored.alert_id,
    dashboardId: stored.dashboard_id,
    panelId: stored.panel_id,
    createdBy: stored.created_by,
    createdAt: stored.created_at,
    how: stored.how,
  };
}

/**
 * Turns a stored change of state into a firing change.
 *
 * @param stored - The stored change.
 * @returns The change.
 */
function changeOf(stored: StoredChange): FiringChange {
  return {
    seriesKey: stored.series_key,
    labels: JSON.parse(stored.labels),
    started: stored.to_state === 'firing',
    at: stored.at,
  };
}

/**
 * Creates the repository over an open database.
 *
 * @param database - A database the migrations have run on.
 * @returns The repository.
 */
export function createAlertLinkRepository(database: Database): AlertLinkRepository {
  const statements = linkStatements(database);
  return {
    add: (row) => {
      const place = [row.alertId, row.dashboardId, row.panelId];
      return statements.add.run(...place, row.createdBy, row.createdAt, row.how).changes > 0;
    },
    remove: (alertId, panel) =>
      statements.remove.run(alertId, panel.dashboardId, panel.panelId).changes > 0,
    forAlert: (alertId) => statements.forAlert.all(alertId).map(linkOf),
    forDashboard: (dashboardId) => statements.forDashboard.all(dashboardId).map(linkOf),
    all: () => statements.all.all().map(linkOf),
    dismiss: (row, by, at) => {
      statements.dismiss.run(row.alertId, row.dashboardId, row.panelId, by, at);
    },
    dismissals: () =>
      statements.dismissals.all().map((stored) => ({
        alertId: stored.alert_id,
        dashboardId: stored.dashboard_id,
        panelId: stored.panel_id,
      })),
    firingChanges: (alertId, until) => statements.firing.all(alertId, until).map(changeOf),
  };
}
