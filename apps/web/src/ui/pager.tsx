import { Button } from './button.tsx';
import styles from './pager.module.css';
import { hasPages, pageNumber, pageRange } from './paging.ts';

/** Props of {@link Pager}. */
interface PagerProps {
  /** What the pages are of, for assistive technology, such as `What happened, pages`. */
  readonly label: string;
  /** How many entries come before the page's first. */
  readonly offset: number;
  /** How many entries the page shows. */
  readonly shown: number;
  /** How many entries the list holds in all. */
  readonly total: number;
  /** Shows the page of newer entries; left out on the first page. */
  readonly onNewer?: (() => void) | undefined;
  /** Shows the page of older entries; left out on the last page. */
  readonly onOlder?: (() => void) | undefined;
  /** Whether a page is loading: the controls wait. */
  readonly busy?: boolean;
  /** What the controls say, for a list that is not in order of time, such as Previous and Next. */
  readonly words?: { readonly newer: string; readonly older: string };
  /** How many entries a page shows, to say which page this is; left out, it is not said. */
  readonly size?: number;
}

/** What the controls of a list say, the latest first. */
const byTime = { newer: 'Newer', older: 'Older' } as const;

/**
 * The foot of a list shown a page at a time, the latest first: which entries the page shows, how
 * many there are in all, and Newer and Older when the list holds more than one page, with the page
 * number when the page size is given. Another list names its controls with `words`.
 *
 * @param props - The place of the page and what its controls do.
 * @returns The pager; nothing for an empty list.
 */
export function Pager(props: PagerProps) {
  const { label, offset, shown, total, onNewer, onOlder, busy = false, words = byTime } = props;
  if (total === 0) return null;
  const paged = offset > 0 || hasPages(shown, total);
  return (
    <nav className={styles.pager} aria-label={label}>
      <span className={styles.range} aria-live="polite">
        {pageRange(offset, shown, total)}
      </span>
      {paged && props.size !== undefined && (
        <span className={styles.page}>{pageNumber(offset, props.size, total)}</span>
      )}
      {paged && (
        <>
          <Button size="small" disabled={busy || !onNewer} onClick={onNewer}>
            {words.newer}
          </Button>
          <Button size="small" disabled={busy || !onOlder} onClick={onOlder}>
            {words.older}
          </Button>
        </>
      )}
    </nav>
  );
}
