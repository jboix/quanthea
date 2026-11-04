import { useState } from 'react';
import { Link, useLoaderData, useSearchParams } from 'react-router';
import { buttonClassName } from '../../ui/button.tsx';
import { EmptyState } from '../../ui/empty-state.tsx';
import { LibraryIcon, SearchIcon } from '../../ui/icons.tsx';
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

/** How many chips show before the rest fold under "+N more": about one row. */
const foldedChips = 8;

/** One filter chip: a connector or a tag, on or off. */
interface FilterChip {
  /** The search parameter it sets. */
  readonly key: 'connector' | 'tag';
  /** Its value. */
  readonly value: string;
  /** Whether it is on. */
  readonly on: boolean;
}

/**
 * The chips to show: those on first, then the rest in order, all of them or one row's worth.
 *
 * @param data - The loader data.
 * @param open - Whether every chip shows.
 * @returns The chips shown, and how many are folded away.
 */
function shownChips(data: DashboardsData, open: boolean) {
  const chips: FilterChip[] = [
    ...data.search.connectors.map((value) => ({
      key: 'connector' as const,
      value,
      on: data.connectors.includes(value),
    })),
    ...data.search.tags.map((value) => ({
      key: 'tag' as const,
      value,
      on: data.tags.includes(value),
    })),
  ];
  const ordered = [...chips.filter((chip) => chip.on), ...chips.filter((chip) => !chip.on)];
  const limit = Math.max(foldedChips, chips.filter((chip) => chip.on).length);
  const shown = open ? ordered : ordered.slice(0, limit);
  return { all: chips.length, shown, folded: ordered.length - shown.length };
}

/**
 * The filter chips: the connectors and tags in the library, each one on or off, on one row with
 * the rest folded under "+N more".
 *
 * @param props - The library data.
 * @param props.data - The loader data.
 * @returns The chips, or nothing when there is nothing to filter by.
 */
function FilterChips({ data }: { readonly data: DashboardsData }) {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const { all, shown, folded } = shownChips(data, open);
  if (all < 2) return null;
  const toggle = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (next.has(key, value)) next.delete(key, value);
    else next.append(key, value);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  return (
    <fieldset className={styles.chips}>
      <legend className={styles.visuallyHidden}>Filter</legend>
      {shown.map(({ key, value, on }) => (
        <button
          key={`${key}-${value}`}
          type="button"
          className={styles.chip}
          aria-pressed={on}
          onClick={() => toggle(key, value)}
        >
          {key === 'tag' ? `#${value}` : value}
        </button>
      ))}
      {(folded > 0 || open) && (
        <button type="button" className={styles.more} onClick={() => setOpen(!open)}>
          {open ? 'Fewer' : `+${folded} more`}
        </button>
      )}
    </fieldset>
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
    <EmptyState
      icon={narrowed ? <SearchIcon /> : <LibraryIcon />}
      title={narrowed ? 'No dashboard matches' : 'Nothing pinned yet'}
    >
      {narrowed
        ? 'Try fewer words, or turn a filter off.'
        : 'Pin a dashboard from its thread and it shows up here, for everyone.'}
    </EmptyState>
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
