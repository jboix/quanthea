import { Link, useLoaderData, useSearchParams } from 'react-router';
import { buttonClassName } from '../../ui/button.tsx';
import { Page } from '../../ui/page.tsx';
import { Tabs, tabPanelProps } from '../../ui/tabs.tsx';
import { useCanEdit } from '../dashboard/index.ts';
import type { DashboardsData, LibraryData } from './data.ts';
import styles from './library.module.css';
import { LibraryCard } from './library-card.tsx';
import { SearchBox } from './search-box.tsx';
import { SnapshotsTab } from './snapshots-tab.tsx';

/** The library's tabs, in order. */
const libraryTabs = [
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'snapshots', label: 'Snapshots' },
] as const;

/** What the page says under its title, by tab. */
const subtitles: Readonly<Record<LibraryData['view'], string>> = {
  dashboards:
    'Pinned dashboards are frozen. Opening one runs its saved queries, with no model involved.',
  snapshots:
    'Dashboards frozen with their data, at links anyone signed in can open. Opening one runs no query.',
};

/**
 * The filter chips: every connector and tag in the library, each one on or off.
 *
 * @param props - The library data.
 * @param props.data - The loader data.
 * @returns The chips, or nothing when there is nothing to filter by.
 */
function FilterChips({ data }: { readonly data: DashboardsData }) {
  const [params, setParams] = useSearchParams();
  const chips = [
    ...data.search.connectors.map((value) => ({ key: 'connector', value, on: data.connectors })),
    ...data.search.tags.map((value) => ({ key: 'tag', value, on: data.tags })),
  ];
  if (chips.length < 2) return null;
  const toggle = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (next.has(key, value)) next.delete(key, value);
    else next.append(key, value);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  return (
    <fieldset className={styles.chips}>
      <legend className={styles.visuallyHidden}>Filter</legend>
      {chips.map(({ key, value, on }) => (
        <button
          key={`${key}-${value}`}
          type="button"
          className={key === 'connector' ? `${styles.chip} ${styles.mono}` : styles.chip}
          aria-pressed={on.includes(value)}
          onClick={() => toggle(key, value)}
        >
          {key === 'tag' ? `#${value}` : value}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The card after the results: ask in a new thread when the library has no answer.
 *
 * @param props - The search words.
 * @param props.q - The search.
 * @returns The card, for editors only.
 */
function AskCard({ q }: { readonly q: string }) {
  if (!useCanEdit()) return null;
  const to = q === '' ? '/threads/new' : `/threads/new?${new URLSearchParams({ question: q })}`;
  return (
    <aside className={styles.ask}>
      <h2 className={styles.askTitle}>Not finding it?</h2>
      <p className={styles.meta}>Ask in a new thread. It can start from one of these instead.</p>
      <Link to={to} className={buttonClassName('secondary')}>
        {q === '' ? 'Ask a question' : `Ask about “${q}”`}
      </Link>
    </aside>
  );
}

/**
 * What the grid says when nothing is found.
 *
 * @param props - Whether the person searched or filtered.
 * @param props.narrowed - `true` when a search or a filter is on.
 * @returns The note.
 */
function EmptyNote({ narrowed }: { readonly narrowed: boolean }) {
  return (
    <p className={styles.empty}>
      {narrowed
        ? 'No pinned dashboard matches. Try fewer words or turn a filter off.'
        : 'Nothing is pinned yet. Pin a dashboard from its thread and it shows up here.'}
    </p>
  );
}

/**
 * The Dashboards tab: search the pinned dashboards and their panels, and filter them by connector
 * and tag.
 *
 * @param props - The tab's data.
 * @param props.data - The loader data.
 * @returns The tab's content.
 */
function DashboardsTab({ data }: { readonly data: DashboardsData }) {
  const { results } = data.search;
  const narrowed = data.q !== '' || data.tags.length > 0 || data.connectors.length > 0;
  return (
    <>
      <SearchBox
        q={data.q}
        count={results.length}
        label="Search the library"
        placeholder="Search dashboards, panels and queries"
      />
      <FilterChips data={data} />
      {results.length === 0 && <EmptyNote narrowed={narrowed} />}
      <div className={styles.grid}>
        {results.map((entry) => (
          <LibraryCard key={entry.dashboardId} entry={entry} />
        ))}
        {narrowed && <AskCard q={data.q} />}
      </div>
    </>
  );
}

/**
 * The Library screen: a Dashboards tab to search the pinned dashboards and open one, which runs
 * its saved queries with no model involved, and a Snapshots tab to search the live snapshots. The
 * tab is kept in the URL, so a link opens it.
 *
 * @returns The screen.
 */
export function LibraryScreen() {
  const data = useLoaderData() as LibraryData;
  const [, setParams] = useSearchParams();
  const canEdit = useCanEdit();
  const select = (view: string) =>
    setParams(view === 'snapshots' ? { view } : {}, { preventScrollReset: true });
  return (
    <Page
      title="Library"
      subtitle={subtitles[data.view]}
      actions={
        canEdit && (
          <Link to="/threads/new" className={buttonClassName('primary', 'large')}>
            New thread
          </Link>
        )
      }
    >
      <Tabs
        label="Library"
        tabs={libraryTabs}
        selected={data.view}
        onSelect={select}
        panels="library"
      />
      <div className={styles.panel} {...tabPanelProps('library', data.view)}>
        {data.view === 'dashboards' ? (
          <DashboardsTab key="dashboards" data={data} />
        ) : (
          <SnapshotsTab key="snapshots" data={data} />
        )}
      </div>
    </Page>
  );
}
