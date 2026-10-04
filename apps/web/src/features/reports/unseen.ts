/**
 * How many reports have a run the person has not opened, for the rail's dot. It reads the list
 * while the list is on screen, and otherwise a resource route that loads when the rail mounts and
 * again after every change made through an action, such as opening a run.
 */
import { useEffect } from 'react';
import { useFetcher, useRouteLoaderData } from 'react-router';
import { type ReportsData, reportsRouteId, unseenPath } from './data.ts';

/**
 * How many reports have a run the person has not opened.
 *
 * @returns The count, or `undefined` until it is known.
 */
export function useUnseenReports(): number | undefined {
  const listed = useRouteLoaderData(reportsRouteId) as ReportsData | undefined;
  const { load, data, state } = useFetcher<{ unseen: number | null }>({ key: 'reports-unseen' });
  const missing = state === 'idle' && data === undefined;
  useEffect(() => {
    if (missing) void load(unseenPath);
  }, [missing, load]);
  if (listed) return listed.reports.filter((each) => each.unseen).length;
  return data?.unseen ?? undefined;
}

/**
 * Counts the reports with an unopened run again once a run opens, since opening one is a load the
 * rail's fetcher does not follow.
 *
 * @param runId - The run open, if any.
 */
export function useRecountUnseen(runId: string | undefined): void {
  const { load } = useFetcher({ key: 'reports-unseen' });
  useEffect(() => {
    if (runId !== undefined) void load(unseenPath);
  }, [runId, load]);
}
