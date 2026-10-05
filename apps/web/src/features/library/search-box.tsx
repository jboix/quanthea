import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SearchIcon } from '../../ui/icons.tsx';
import styles from './library.module.css';

/** Props of {@link SearchBox}. */
interface SearchBoxProps {
  /** The search words in the URL. */
  readonly q: string;
  /** How many results match. */
  readonly count: number;
  /** The box's accessible name. */
  readonly label: string;
  /** The hint in the empty box. */
  readonly placeholder: string;
}

/**
 * A library tab's search box. It searches as the person types, a moment after they pause, and
 * keeps the rest of the URL.
 *
 * @param props - The search, the count, and the box's words.
 * @returns The box.
 */
export function SearchBox({ q, count, label, placeholder }: SearchBoxProps) {
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
        aria-label={label}
        className={styles.searchInput}
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <span className={styles.count} aria-live="polite">
        {count === 1 ? '1 result' : `${count} results`}
      </span>
    </search>
  );
}
