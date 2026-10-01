/**
 * The library: the pinned dashboards outside the bin, found by a full-text search over their
 * titles, descriptions, tags, panels and queries, each with the panels that match.
 */
import {
  type DashboardSpec,
  dashboardSpecSchema,
  type LibraryEntry,
  type LibrarySearch,
  type Panel,
} from '@quanthea/shared';
import type { PinnedRow } from '../db/dashboard-pinned.ts';
import type { ServiceContext } from './context.ts';

/** What the library is asked for. */
export interface LibraryQuery {
  /** The search words, if any. */
  readonly q?: string | undefined;
  /** The tags a dashboard must all have. */
  readonly tags: readonly string[];
  /** The connectors a dashboard must all read. */
  readonly connectors: readonly string[];
}

/** A pinned dashboard with its parsed spec. */
interface Pinned {
  /** The stored row. */
  readonly row: PinnedRow;
  /** Its pinned spec. */
  readonly spec: DashboardSpec;
}

/** How a dashboard matched: its best rank, lower is better, and its matching panels. */
interface Match {
  /** The best BM25 rank of the dashboard or its panels. */
  readonly rank: number;
  /** The panels whose own text matches, the best first. */
  readonly panelIds: string[];
}

/** The most dashboards a search returns. */
const maxResults = 60;

/**
 * The words of a search, lowercase.
 *
 * @param q - The search.
 * @returns The runs of letters and digits.
 */
function wordsOf(q: string): string[] {
  return q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The connectors a spec's panels read.
 *
 * @param spec - The spec.
 * @returns The names, in order of first use.
 */
function connectorsOf(spec: DashboardSpec): string[] {
  return [
    ...new Set(spec.panels.flatMap((panel) => panel.queries.map((query) => query.connector))),
  ];
}

/**
 * The panel a card draws: the best matching panel, else the first chart, else the first panel.
 *
 * @param spec - The spec.
 * @param panelIds - The matching panels, the best first.
 * @returns The panel, or `null` when the dashboard has none.
 */
function previewOf(spec: DashboardSpec, panelIds: readonly string[]): Panel | null {
  const matched = spec.panels.find((panel) => panel.id === panelIds[0]);
  return (
    matched ?? spec.panels.find((panel) => panel.view.kind === 'chart') ?? spec.panels[0] ?? null
  );
}

/**
 * The pinned dashboards whose spec still parses.
 *
 * @param context - The service context.
 * @returns The dashboards, the most recently changed first.
 */
function pinnedDashboards(context: ServiceContext): Pinned[] {
  return context.repository.listPinned().flatMap((row) => {
    const parsed = dashboardSpecSchema.safeParse(row.spec);
    return parsed.success ? [{ row, spec: parsed.data }] : [];
  });
}

/**
 * How each dashboard matches the words: every word must match the dashboard or one panel, with
 * their context; a panel is listed when its own text matches any word.
 *
 * @param context - The service context.
 * @param words - The search words.
 * @returns The matches by dashboard.
 */
function matchesOf(context: ServiceContext, words: readonly string[]): Map<string, Match> {
  const matches = new Map<string, Match>();
  // The hits come the best first, so a dashboard's first hit holds its best rank.
  for (const hit of context.repository.library.matchAll(words))
    if (!matches.has(hit.dashboardId))
      matches.set(hit.dashboardId, { rank: hit.rank, panelIds: [] });
  for (const hit of context.repository.library.panelsMatchingAny(words)) {
    const panelIds = matches.get(hit.dashboardId)?.panelIds;
    if (hit.panelId !== null && panelIds?.includes(hit.panelId) === false)
      panelIds.push(hit.panelId);
  }
  return matches;
}

/**
 * One dashboard as the library shows it.
 *
 * @param pinned - The dashboard.
 * @param titles - The library's titles by dashboard, for the parent's.
 * @param panelIds - Its matching panels, the best first.
 * @returns The entry.
 */
function entryOf(
  { row, spec }: Pinned,
  titles: ReadonlyMap<string, string>,
  panelIds: readonly string[],
): LibraryEntry {
  const parentTitle =
    row.parentDashboardId === null ? undefined : titles.get(row.parentDashboardId);
  const byId = new Map(spec.panels.map((panel) => [panel.id, panel]));
  const panels = panelIds.flatMap((id) => {
    const panel = byId.get(id);
    return panel ? [{ id, title: panel.title, description: panel.description ?? null }] : [];
  });
  return {
    dashboardId: row.dashboardId,
    title: row.title,
    description: row.description,
    tags: [...row.tags],
    version: row.version,
    pinnedAt: row.pinnedAt,
    parent:
      parentTitle === undefined || row.parentDashboardId === null
        ? null
        : { dashboardId: row.parentDashboardId, title: parentTitle },
    connectors: connectorsOf(spec),
    panelCount: spec.panels.length,
    panels,
    preview: previewOf(spec, panelIds),
    timeZone: spec.timezone ?? null,
  };
}

/**
 * Whether a dashboard has every tag and reads every connector asked for.
 *
 * @param pinned - The dashboard.
 * @param query - The filters.
 * @returns Whether it passes.
 */
function passesFilters({ row, spec }: Pinned, query: LibraryQuery): boolean {
  const connectors = connectorsOf(spec);
  return (
    query.tags.every((tag) => row.tags.includes(tag)) &&
    query.connectors.every((connector) => connectors.includes(connector))
  );
}

/**
 * Searches the library.
 *
 * @param context - The service context.
 * @param query - The words and the filters.
 * @returns The matching dashboards, the best first, and every tag and connector for the filters.
 */
export function searchLibrary(context: ServiceContext, query: LibraryQuery): LibrarySearch {
  const all = pinnedDashboards(context);
  const titles = new Map(all.map(({ row }) => [row.dashboardId, row.title]));
  const words = wordsOf(query.q ?? '');
  const matches = words.length > 0 ? matchesOf(context, words) : undefined;
  const found = all.filter(
    (pinned) => (!matches || matches.has(pinned.row.dashboardId)) && passesFilters(pinned, query),
  );
  const rankOf = (pinned: Pinned) => matches?.get(pinned.row.dashboardId)?.rank ?? 0;
  const results = found
    .sort((first, second) => rankOf(first) - rankOf(second))
    .slice(0, maxResults)
    .map((pinned) => entryOf(pinned, titles, matches?.get(pinned.row.dashboardId)?.panelIds ?? []));
  return {
    results,
    tags: [...new Set(all.flatMap(({ row }) => row.tags))].sort(),
    connectors: [...new Set(all.flatMap(({ spec }) => connectorsOf(spec)))].sort(),
  };
}
