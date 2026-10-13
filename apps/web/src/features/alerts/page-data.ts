/**
 * Loads the pages of an alert's lists after the first, which the alert carries: what happened to
 * it and the messages sent about it. A page is named by the cursor of the page before.
 */
import {
  type AlertSendsPage,
  type AlertTimelinePage,
  getAlertTimelineEndpoint,
  listAlertSendsEndpoint,
} from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What every page says of its place in its list. */
export interface PagePlace {
  /** The cursor of the page of older entries; `null` at the end of the list. */
  readonly older: string | null;
  /** How many entries the list holds in all. */
  readonly total: number;
  /** How many entries of the list are newer than the page's first. */
  readonly offset: number;
}

/** What a page load answers, with the cursor it was asked for. */
export type PageOutcome<Page> =
  | { readonly ok: true; readonly before: string; readonly page: Page }
  | { readonly ok: false; readonly before: string; readonly message: string };

/** A page that was loaded, with the cursor it follows. */
export interface LoadedPage<Page> {
  /** The cursor it was asked for. */
  readonly before: string;
  /** The page. */
  readonly page: Page;
}

/**
 * The pages below the first once a load has answered: the page asked for goes under the others.
 *
 * @param loaded - The pages below the first, the deepest last.
 * @param wanted - The cursor asked for, if a page is awaited.
 * @param outcome - What the latest load answered, if any.
 * @returns The pages with the one that arrived, or `undefined` when the answer is not the page
 *   awaited.
 */
export function withArrived<Page>(
  loaded: readonly LoadedPage<Page>[],
  wanted: string | undefined,
  outcome: PageOutcome<Page> | undefined,
): LoadedPage<Page>[] | undefined {
  if (wanted === undefined || !outcome?.ok || outcome.before !== wanted) return undefined;
  return [...loaded, { before: outcome.before, page: outcome.page }];
}

/**
 * Builds the loader of a paged list.
 *
 * @param read - Reads the page after a cursor.
 * @returns The loader. A refusal comes back as a message.
 */
function pageLoader<Page>(
  read: (alertId: string, before: string, signal: AbortSignal) => Promise<Page>,
) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<PageOutcome<Page>> => {
    const before = new URL(request.url).searchParams.get('before') ?? '';
    try {
      return { ok: true, before, page: await read(params.alertId ?? '', before, request.signal) };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, before, message: error.message };
    }
  };
}

/**
 * Loads a page of what happened to an alert.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAlertTimeline(api: ApiClient) {
  return pageLoader<AlertTimelinePage>((alertId, before, signal) =>
    api.call(getAlertTimelineEndpoint, { params: { alertId }, query: { before } }, { signal }),
  );
}

/**
 * Loads a page of the messages sent about an alert.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadAlertSends(api: ApiClient) {
  return pageLoader<AlertSendsPage>((alertId, before, signal) =>
    api.call(listAlertSendsEndpoint, { params: { alertId }, query: { before } }, { signal }),
  );
}
