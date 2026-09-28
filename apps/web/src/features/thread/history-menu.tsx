import type { ThreadSummary } from '@querent/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { BinIcon, HistoryIcon } from '../../ui/icons.tsx';
import type { NewThreadIntent } from './data.ts';
import styles from './history-menu.module.css';

/**
 * Whether a menu is open, closing it on a click outside its container or on Escape.
 *
 * @returns The container ref, whether it is open, and the toggle.
 */
function useMenu() {
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const outside = !container.current?.contains(event.target as Node);
      if (outside || (event as KeyboardEvent).key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return { container, open, toggle: () => setOpen(!open) };
}

/**
 * One past thread: a link to it, and a delete button that asks before deleting.
 *
 * @param props - The thread and the date format.
 * @param props.thread - The thread.
 * @param props.date - Formats the last change.
 * @returns The row.
 */
function HistoryRow({
  thread,
  date,
}: {
  readonly thread: ThreadSummary;
  readonly date: Intl.DateTimeFormat;
}) {
  const [confirming, setConfirming] = useState(false);
  const fetcher = useFetcher();
  const title = thread.title ?? 'Untitled thread';
  const remove = () => {
    const intent: NewThreadIntent = { intent: 'delete', threadId: thread.id };
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  };
  if (confirming) {
    return (
      <li className={styles.row} data-deleting={fetcher.state !== 'idle'}>
        <div className={styles.confirm}>
          <span>Delete “{title}”? Pinned dashboards stay.</span>
          <Button size="small" variant="danger" onClick={remove}>
            Delete
          </Button>
          <Button size="small" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className={styles.row}>
      <Link to={`/threads/${thread.id}`} className={styles.historyItem}>
        <span className={styles.historyTitle}>{title}</span>
        <span className={styles.historyDate}>{date.format(thread.updatedAt)}</span>
      </Link>
      <button
        type="button"
        className={styles.delete}
        aria-label={`Delete ${title}`}
        onClick={() => setConfirming(true)}
      >
        <BinIcon />
      </button>
    </li>
  );
}

/**
 * Past threads, behind a button at the top right, each with a way to delete it.
 *
 * @param props - The threads.
 * @param props.threads - The recent threads, the latest first.
 * @returns The button and its list, or nothing when there are no threads.
 */
export function HistoryMenu({ threads }: { readonly threads: readonly ThreadSummary[] }) {
  const menu = useMenu();
  if (threads.length === 0) return null;
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div ref={menu.container} className={styles.menu}>
      <button
        type="button"
        className={styles.historyButton}
        aria-expanded={menu.open}
        onClick={menu.toggle}
      >
        <HistoryIcon />
        Past threads
      </button>
      {menu.open && (
        <nav className={styles.history} aria-label="Past threads">
          <ul>
            {threads.map((thread) => (
              <HistoryRow key={thread.id} thread={thread} date={date} />
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
