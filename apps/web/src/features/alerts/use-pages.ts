import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { type LoadedPage, type PageOutcome, type PagePlace, withArrived } from './page-data.ts';

/** A list a page at a time, as a card shows it. */
export interface Pages<Page> {
  /** The page shown. */
  readonly page: Page;
  /** Shows the page of newer entries; `undefined` on the first page. */
  readonly onNewer: (() => void) | undefined;
  /** Shows the page of older entries; `undefined` on the last page. */
  readonly onOlder: (() => void) | undefined;
  /** Whether a page is loading. */
  readonly busy: boolean;
  /** Why the page asked for did not load, if it did not. */
  readonly failure: string | undefined;
}

/**
 * Pages through a list whose first page the alert carries. Older loads the page after the one
 * shown and Newer goes back to the page before, without loading it again.
 *
 * @param first - The first page.
 * @param path - The resource route that loads a page by its `before` cursor.
 * @returns The page shown and its controls.
 */
export function usePages<Page extends PagePlace>(first: Page, path: string): Pages<Page> {
  const [loaded, setLoaded] = useState<readonly LoadedPage<Page>[]>([]);
  const [wanted, setWanted] = useState<string>();
  const { load, data, state } = useFetcher<PageOutcome<Page>>();
  useEffect(() => {
    const arrived = withArrived(loaded, wanted, data);
    if (!arrived) return;
    setLoaded(arrived);
    setWanted(undefined);
  }, [loaded, wanted, data]);
  const page = loaded.at(-1)?.page ?? first;
  const { older } = page;
  const askOlder = (before: string) => {
    setWanted(before);
    void load(`${path}?before=${encodeURIComponent(before)}`);
  };
  return {
    page,
    onNewer: loaded.length > 0 ? () => setLoaded(loaded.slice(0, -1)) : undefined,
    onOlder: older === null ? undefined : () => askOlder(older),
    busy: state !== 'idle',
    failure: wanted !== undefined && data?.ok === false ? data.message : undefined,
  };
}
