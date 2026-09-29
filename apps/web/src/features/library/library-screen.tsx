import { useEffect, useState } from 'react';
import { Link, useLoaderData, useSearchParams } from 'react-router';
import { buttonClassName } from '../../ui/button.tsx';
import { SearchIcon } from '../../ui/icons.tsx';
import { Page } from '../../ui/page.tsx';
import { useCanEdit } from '../dashboard/index.ts';
import type { LibraryData } from './data.ts';
import styles from './library.module.css';
import { LibraryCard } from './library-card.tsx';

/**
 * The search box. It searches as the person types, a moment after they pause, and keeps the
 * filters.
 *
 * @param props - The search in the URL, and how many dashboards match.
 * @param props.q - The search words.
 * @param props.count - The number of results.
 * @returns The box.
 */
function SearchBox({ q, count }: { readonly q: string; readonly count: number }) {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(q);
  useEffect(() => {
    const words = text.trim();
    if (words === (params.get('q') ?? '')) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (words === '') next.delete('q');
      else next.set('q', words);
      setParams(next, { replace: true, preventScrollReset: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [text, params, setParams]);
  return (
    <search className={styles.search}>
      <span className={styles.searchIcon}>
        <SearchIcon />
      </span>
      <input
        type="search"
        aria-label="Search the library"
        className={styles.searchInput}
        placeholder="Search dashboards, panels and queries"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <span className={styles.count} aria-live="polite">
        {count === 1 ? '1 result' : `${count} results`}
      </span>
    </search>
  );
}

/**
 * The filter chips: every connector and tag in the library, each one on or off.
 *
 * @param props - The library data.
 * @param props.data - The loader data.
 * @returns The chips, or nothing when there is nothing to filter by.
 */
function FilterChips({ data }: { readonly data: LibraryData }) {
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
 * The Library screen: search the pinned dashboards and their panels, filter them by connector and
 * tag, and open one. Opening one runs its saved queries, with no model involved.
 *
 * @returns The screen.
 */
export function LibraryScreen() {
  const data = useLoaderData() as LibraryData;
  const { results } = data.search;
  const narrowed = data.q !== '' || data.tags.length > 0 || data.connectors.length > 0;
  const canEdit = useCanEdit();
  return (
    <Page
      title="Library"
      subtitle="Pinned dashboards are frozen. Opening one runs its saved queries, with no model involved."
      actions={
        canEdit && (
          <Link to="/threads/new" className={buttonClassName('primary', 'large')}>
            New thread
          </Link>
        )
      }
    >
      <SearchBox q={data.q} count={results.length} />
      <FilterChips data={data} />
      {results.length === 0 && <EmptyNote narrowed={narrowed} />}
      <div className={styles.grid}>
        {results.map((entry) => (
          <LibraryCard key={entry.dashboardId} entry={entry} />
        ))}
        {narrowed && <AskCard q={data.q} />}
      </div>
    </Page>
  );
}
