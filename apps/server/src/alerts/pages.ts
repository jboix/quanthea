/**
 * The lists of an alert's page, a page at a time: what happened to it and the messages sent about
 * it. A page's `older` cursor names its last entry, so the page after it holds the same entries
 * whatever arrives in the meantime. People are named by user id here; the routes name them.
 */
import {
  type AlertSendsPage,
  type AlertTimelineEntry,
  type AlertTimelinePage,
  alertActions,
} from '@quanthea/shared';
import {
  type AlertPagesRepository,
  firstPage,
  type PageCursor,
  type TimelineRow,
} from '../db/alert-pages.ts';

/** Which page to read. */
export interface PageRequest {
  /** The `older` cursor of the page before; the first page when left out. */
  readonly before?: string | undefined;
  /** The most entries to return. */
  readonly limit: number;
}

/** Reads nothing, for a service built without the paged lists. */
export const noPages: AlertPagesRepository = {
  timeline: () => [],
  timelineCount: () => 0,
  sends: () => [],
  sendCount: () => 0,
};

/**
 * Reads a cursor.
 *
 * @param before - The cursor, `time:id`, or nothing for the first page.
 * @returns Where the page starts.
 */
function cursorOf(before: string | undefined): PageCursor {
  if (before === undefined) return firstPage;
  const colon = before.indexOf(':');
  return { at: Number(before.slice(0, colon)), id: before.slice(colon + 1) };
}

/**
 * Reads one page of a list.
 *
 * @param request - Which page.
 * @param read - Reads the rows after a cursor, the latest first.
 * @param count - Counts the rows after a cursor.
 * @returns The rows of the page and its place in the list.
 */
function pageOf<Row extends PageCursor>(
  request: PageRequest,
  read: (after: PageCursor, limit: number) => Row[],
  count: (after: PageCursor) => number,
): { rows: Row[]; older: string | null; total: number; offset: number } {
  const after = cursorOf(request.before);
  const found = read(after, request.limit + 1);
  const rows = found.slice(0, request.limit);
  const last = rows.at(-1);
  const older = found.length > request.limit && last ? `${last.at}:${last.id}` : null;
  const total = count(firstPage);
  return { rows, older, total, offset: after === firstPage ? 0 : total - count(after) };
}

/**
 * Something someone did, as the API shows it.
 *
 * @param change - The audit entry.
 * @returns The entry, or nothing for an action the timeline does not show.
 */
function activityOf(change: TimelineRow & { type: 'change' }): AlertTimelineEntry[] {
  const action = alertActions.find((each) => `alert.${each}` === change.action);
  if (!action) return [];
  const detail = (change.detail ?? {}) as { version?: unknown; until?: unknown };
  const version = typeof detail.version === 'number' ? detail.version : null;
  const until = typeof detail.until === 'number' ? detail.until : null;
  const { id, at, actor } = change;
  return [{ type: 'activity', id, action, at, by: actor, version, until }];
}

/**
 * One stored entry as the API shows it.
 *
 * @param row - The stored entry.
 * @returns The entry.
 */
function entryOf(row: TimelineRow): AlertTimelineEntry[] {
  if (row.type === 'change') return activityOf(row);
  if (row.type === 'event') return [{ ...row, labels: { ...row.labels } }];
  return [{ ...row }];
}

/**
 * Reads a page of what happened to an alert.
 *
 * @param pages - The paged lists.
 * @param alertId - The alert.
 * @param request - Which page.
 * @returns The page, the latest first.
 */
export function timelinePage(
  pages: AlertPagesRepository,
  alertId: string,
  request: PageRequest,
): AlertTimelinePage {
  const { rows, ...place } = pageOf(
    request,
    (after, limit) => pages.timeline(alertId, after, limit),
    (after) => pages.timelineCount(alertId, after),
  );
  return { entries: rows.flatMap(entryOf), ...place };
}

/**
 * Reads a page of the messages sent about an alert.
 *
 * @param pages - The paged lists.
 * @param alertId - The alert.
 * @param request - Which page.
 * @returns The page, the latest first.
 */
export function sendsPage(
  pages: AlertPagesRepository,
  alertId: string,
  request: PageRequest,
): AlertSendsPage {
  const { rows, ...place } = pageOf(
    request,
    (after, limit) => pages.sends(alertId, after, limit),
    (after) => pages.sendCount(alertId, after),
  );
  return { sends: rows, ...place };
}
