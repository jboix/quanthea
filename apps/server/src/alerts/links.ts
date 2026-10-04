/**
 * The links between alerts and dashboard panels. A link is made by a person: from the panel the
 * alert's conversation started from, from the agent's card, by hand, or from a suggestion when
 * the alert's query and a pinned panel's match. Nothing links on its own. Every role reads links;
 * editors make, remove and dismiss them.
 */
import {
  type AlertLinkHow,
  type AlertLinks,
  type DashboardAlerts,
  hasRole,
  type LinkSuggestion,
  type LinkTarget,
  type ResolvedTimeRange,
  type Role,
  type ShownOn,
} from '@quanthea/shared';
import type { Dashboards } from '../dashboards/dashboards.ts';
import type {
  AlertLinkRepository,
  AlertLinkRow,
  LinkedPanel,
} from '../db/alert-link-repository.ts';
import type { AlertRepository, AlertRow } from '../db/alert-repository.ts';
import type { AlertStateRepository } from '../db/alert-state-repository.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { PinnedRow } from '../db/dashboard-pinned.ts';
import { AppError } from '../lib/errors.ts';
import { panelAlertOf } from './link-alert.ts';
import { matchingPanels, type PinnedPanel, pairKey, pinnedPanels } from './link-match.ts';
import { canSeeAlert } from './views.ts';

/** What the links need. */
export interface AlertLinksDependencies {
  /** Stores links and dismissals. */
  readonly links: AlertLinkRepository;
  /** Reads alerts and their versions. */
  readonly repository: Pick<AlertRepository, 'get' | 'list' | 'version'>;
  /** Reads the state of their series. */
  readonly states: Pick<AlertStateRepository, 'series'>;
  /** Reads dashboards as a role may see them. */
  readonly dashboards: Pick<Dashboards, 'get' | 'getVersion'>;
  /** Lists the pinned dashboards with their pinned specs. */
  readonly pinned: () => PinnedRow[];
  /** Records who linked and unlinked. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** A link to make: the panel and how. */
export type NewLink = LinkedPanel & { readonly how: Exclude<AlertLinkHow, 'from_panel'> };

/** The links service. */
export interface PanelLinks {
  /**
   * Where an alert is shown, and for editors the pinned panels whose query matches its own.
   *
   * @param alertId - The alert.
   * @param role - The role of the reader.
   * @returns The links and the suggestions.
   * @throws {AppError} `not_found` for an alert the role may not see.
   */
  forAlert(alertId: string, role: Role): AlertLinks;
  /**
   * Links an alert to a panel of a pinned version.
   *
   * @param alertId - The alert.
   * @param link - The panel and how.
   * @param actor - Who links.
   * @throws {AppError} `not_found` for an unknown alert, or a panel no pinned version has.
   */
  link(alertId: string, link: NewLink, actor: string): void;
  /**
   * Removes a link.
   *
   * @param alertId - The alert.
   * @param panel - The panel.
   * @param actor - Who unlinks.
   * @throws {AppError} `not_found` when there is no such link.
   */
  unlink(alertId: string, panel: LinkedPanel, actor: string): void;
  /**
   * Dismisses a suggestion, so it is not suggested again.
   *
   * @param alertId - The alert.
   * @param panel - The panel.
   * @param actor - Who dismisses.
   * @throws {AppError} `not_found` for an unknown alert, or a panel no pinned version has.
   */
  dismiss(alertId: string, panel: LinkedPanel, actor: string): void;
  /**
   * The pinned dashboards and their panels, to pick one to link.
   *
   * @returns The dashboards, the most recently changed first.
   */
  targets(): LinkTarget[];
  /**
   * The alerts on a dashboard's panels: their state, threshold and firing periods over a range,
   * and for editors the suggestions.
   *
   * @param dashboardId - The dashboard.
   * @param role - The role of the reader.
   * @param range - The range of the firing periods.
   * @returns The alerts, the links and the suggestions.
   * @throws {AppError} `not_found` for a dashboard the role may not see.
   */
  forDashboard(dashboardId: string, role: Role, range: ResolvedTimeRange): DashboardAlerts;
  /**
   * The pinned panels whose query matches the alert's latest version, not linked or dismissed,
   * for the agent to propose.
   *
   * @param alertId - The alert.
   * @returns The panels.
   */
  candidates(alertId: string): LinkSuggestion[];
}

/** The service's dependencies with the clock resolved. */
type LinksContext = AlertLinksDependencies & { readonly now: () => number };

/**
 * Reads an alert the role may see.
 *
 * @param context - The service context.
 * @param alertId - The alert.
 * @param role - The role.
 * @returns The alert.
 * @throws {AppError} `not_found`.
 */
function visibleAlert(context: LinksContext, alertId: string, role: Role): AlertRow {
  const alert = context.repository.get(alertId);
  if (!alert || !canSeeAlert(alert, role)) throw new AppError('not_found', `No alert ${alertId}.`);
  return alert;
}

/**
 * Turns a link into what the alert page lists, or nothing when the role may not see the dashboard.
 *
 * @param context - The service context.
 * @param link - The link.
 * @param role - The role.
 * @returns The panel it is shown on.
 */
function shownOn(context: LinksContext, link: AlertLinkRow, role: Role): ShownOn[] {
  try {
    const dashboard = context.dashboards.get(link.dashboardId, role);
    const version = dashboard.pinnedVersion ?? dashboard.versions.at(-1)?.version;
    if (version === undefined) return [];
    const { spec } = context.dashboards.getVersion(link.dashboardId, version, role);
    const panel = spec.panels.find((each) => each.id === link.panelId);
    const { panelId, how, createdAt, dashboardId } = link;
    const pinned = dashboard.pinnedVersion !== null;
    const title = dashboard.title;
    const shown = { dashboardId, dashboardTitle: title, panelId, version, pinned, how, createdAt };
    return [{ ...shown, panelTitle: panel?.title ?? null }];
  } catch (error) {
    if (error instanceof AppError && error.code === 'not_found') return [];
    throw error;
  }
}

/**
 * The pairs of alerts and panels already linked or dismissed.
 *
 * @param context - The service context.
 * @returns Their keys.
 */
function settledPairs(context: LinksContext): Set<string> {
  const pairs = [...context.links.all(), ...context.links.dismissals()];
  return new Set(pairs.map((pair) => pairKey(pair.alertId, pair)));
}

/**
 * The pinned panels whose query matches an alert version's, not linked or dismissed.
 *
 * @param context - The service context.
 * @param alertId - The alert.
 * @param version - The version whose query is compared.
 * @param panels - The panels of the pinned versions.
 * @returns The suggestions.
 */
function suggestionsFor(
  context: LinksContext,
  alertId: string,
  version: number | null,
  panels: readonly PinnedPanel[],
): LinkSuggestion[] {
  const row = version === null ? undefined : context.repository.version(alertId, version);
  if (!row) return [];
  const settled = settledPairs(context);
  const query = (row.spec as { readonly query?: unknown } | null)?.query;
  return matchingPanels(query, panels)
    .filter((panel) => !settled.has(pairKey(alertId, panel)))
    .map(({ fingerprints: _, ...panel }) => panel);
}

/**
 * Finds a panel on a pinned version, to link or dismiss.
 *
 * @param context - The service context.
 * @param panel - The dashboard and the panel.
 * @throws {AppError} `not_found` when no pinned version has it.
 */
function requirePinnedPanel(context: LinksContext, panel: LinkedPanel): void {
  const pinned = context.pinned().find((row) => row.dashboardId === panel.dashboardId);
  const found = pinnedPanels(pinned ? [pinned] : []).some((each) => each.panelId === panel.panelId);
  if (!found)
    throw new AppError('not_found', `No pinned dashboard ${panel.dashboardId} with that panel.`);
}

/**
 * Creates the links service.
 *
 * @param dependencies - The stores, the dashboards, the audit log and the clock.
 * @returns The service.
 */
export function createPanelLinks(dependencies: AlertLinksDependencies): PanelLinks {
  const context: LinksContext = { ...dependencies, now: dependencies.now ?? Date.now };
  return {
    forAlert: (alertId, role) => linksOf(context, alertId, role),
    link: (alertId, link, actor) => {
      visibleAlert(context, alertId, 'editor');
      requirePinnedPanel(context, link);
      const row = { ...link, alertId, createdBy: actor, createdAt: context.now() };
      context.links.add(row);
      const detail = { dashboardId: link.dashboardId, panelId: link.panelId, how: link.how };
      context.audit.append({ actor, action: 'alert.link', target: alertId, detail });
    },
    unlink: (alertId, panel, actor) => {
      if (!context.links.remove(alertId, panel))
        throw new AppError('not_found', 'The alert is not linked to that panel.');
      context.audit.append({ actor, action: 'alert.unlink', target: alertId, detail: panel });
    },
    dismiss: (alertId, panel, actor) => {
      visibleAlert(context, alertId, 'editor');
      requirePinnedPanel(context, panel);
      context.links.dismiss({ ...panel, alertId }, actor, context.now());
    },
    targets: () => targetsOf(context),
    forDashboard: (dashboardId, role, range) => dashboardAlerts(context, dashboardId, role, range),
    candidates: (alertId) => {
      const alert = context.repository.get(alertId);
      if (!alert) return [];
      return suggestionsFor(context, alertId, alert.latestVersion, pinnedPanels(context.pinned()));
    },
  };
}

/**
 * Where an alert is shown, and for editors the suggestions on its active version.
 *
 * @param context - The service context.
 * @param alertId - The alert.
 * @param role - The role.
 * @returns The links and the suggestions.
 */
function linksOf(context: LinksContext, alertId: string, role: Role): AlertLinks {
  const alert = visibleAlert(context, alertId, role);
  const links = context.links.forAlert(alertId).flatMap((link) => shownOn(context, link, role));
  if (!hasRole(role, 'editor')) return { links, suggestions: [], dismissed: [] };
  const panels = pinnedPanels(context.pinned());
  const suggestions = suggestionsFor(context, alertId, alert.activeVersion, panels);
  const dismissed = context.links
    .dismissals()
    .filter((each) => each.alertId === alertId)
    .map(({ dashboardId, panelId }) => ({ dashboardId, panelId }));
  return { links, suggestions, dismissed };
}

/**
 * The pinned dashboards and their panels.
 *
 * @param context - The service context.
 * @returns The targets.
 */
function targetsOf(context: LinksContext): LinkTarget[] {
  return context.pinned().map((row) => ({
    dashboardId: row.dashboardId,
    title: row.title,
    version: row.version,
    panels: pinnedPanels([row]).map((panel) => ({ id: panel.panelId, title: panel.panelTitle })),
  }));
}

/**
 * The alerts on a dashboard's panels.
 *
 * @param context - The service context.
 * @param dashboardId - The dashboard.
 * @param role - The role.
 * @param range - The range of the firing periods.
 * @returns The alerts, the links and the suggestions.
 */
function dashboardAlerts(
  context: LinksContext,
  dashboardId: string,
  role: Role,
  range: ResolvedTimeRange,
): DashboardAlerts {
  context.dashboards.get(dashboardId, role);
  const visible = (alertId: string) => {
    const alert = context.repository.get(alertId);
    return alert !== undefined && canSeeAlert(alert, role);
  };
  const links = context.links
    .forDashboard(dashboardId)
    .filter((link) => visible(link.alertId))
    .map(({ alertId, panelId }) => ({ alertId, panelId }));
  const suggestions = hasRole(role, 'editor') ? dashboardSuggestions(context, dashboardId) : [];
  const ids = [...new Set([...links, ...suggestions].map((each) => each.alertId))];
  const alerts = ids.flatMap((id) => {
    const alert = context.repository.get(id);
    return alert ? [panelAlertOf(context, alert, range)] : [];
  });
  return { alerts, links, suggestions };
}

/**
 * The alerts whose active query matches a panel of the dashboard's pinned version, not linked or
 * dismissed.
 *
 * @param context - The service context.
 * @param dashboardId - The dashboard.
 * @returns The alert and panel of each suggestion.
 */
function dashboardSuggestions(context: LinksContext, dashboardId: string) {
  const pinned = context.pinned().filter((row) => row.dashboardId === dashboardId);
  if (pinned.length === 0) return [];
  const panels = pinnedPanels(pinned);
  return context.repository
    .list()
    .filter((alert) => alert.activeVersion !== null)
    .flatMap((alert) =>
      suggestionsFor(context, alert.id, alert.activeVersion, panels).map((panel) => ({
        alertId: alert.id,
        panelId: panel.panelId,
      })),
    );
}
