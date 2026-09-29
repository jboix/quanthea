import type { ThreadListItem } from '@querent/shared';
import { useMemo, useState } from 'react';
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Drawer } from '../../ui/drawer.tsx';
import { BinIcon, HistoryIcon, PinIcon, SearchIcon } from '../../ui/icons.tsx';
import type { NewThreadIntent, ThreadOutcome } from './data.ts';
import { filterThreads, groupByDay, type ThreadFilter, untitled } from './thread-list.ts';
import styles from './threads-drawer.module.css';

/** What a thread's state adds to its date, when it waits on the person or the agent. */
const stateNotes: Partial<Record<ThreadListItem['state'], string>> = {
  plan_pending: 'plan waiting',
  building: 'building',
};

/**
 * Asks before deleting a thread, then deletes it.
 *
 * @param props - The thread's title, the delete callback, and the cancel callback.
 * @param props.title - The thread's title.
 * @param props.onDelete - Deletes the thread.
 * @param props.onCancel - Keeps it.
 * @returns The question and its buttons.
 */
function ConfirmDelete({
  title,
  onDelete,
  onCancel,
}: {
  readonly title: string;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className={styles.confirm}>
      <span>Move “{title}” to the bin? You can restore it from there.</span>
      <Button size="small" variant="danger" onClick={onDelete}>
        Delete
      </Button>
      <Button size="small" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * The button that moves a thread to the bin. A thread whose dashboard is pinned can't go, so its
 * button says why instead.
 *
 * @param props - The thread, its title and the click callback.
 * @param props.thread - The thread.
 * @param props.title - Its title.
 * @param props.onClick - Asks before deleting.
 * @returns The button.
 */
function DeleteButton({
  thread,
  title,
  onClick,
}: {
  readonly thread: ThreadListItem;
  readonly title: string;
  readonly onClick: () => void;
}) {
  const label = thread.pinned
    ? `Unpin its dashboard to delete ${title}`
    : `Move ${title} to the bin`;
  return (
    <button
      type="button"
      className={styles.delete}
      aria-label={label}
      title={thread.pinned ? 'Unpin its dashboard to delete this thread' : 'Move to the bin'}
      disabled={thread.pinned}
      onClick={onClick}
    >
      <BinIcon />
    </button>
  );
}

/**
 * One past thread: a link to it with a pin when its dashboard is pinned, and a delete button that
 * asks before deleting.
 *
 * @param props - The thread and the date format.
 * @param props.thread - The thread.
 * @param props.date - Formats the last change.
 * @returns The row.
 */
function ThreadRow({
  thread,
  date,
}: {
  readonly thread: ThreadListItem;
  readonly date: Intl.DateTimeFormat;
}) {
  const [confirming, setConfirming] = useState(false);
  const fetcher = useFetcher<ThreadOutcome>();
  const title = thread.title ?? untitled;
  const remove = () => {
    const intent: NewThreadIntent = { intent: 'delete', threadId: thread.id };
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  };
  const note = stateNotes[thread.state];
  return (
    <li className={styles.row} data-deleting={fetcher.state !== 'idle'}>
      {confirming ? (
        <ConfirmDelete title={title} onDelete={remove} onCancel={() => setConfirming(false)} />
      ) : (
        <>
          <Link to={`/threads/${thread.id}`} className={styles.item}>
            <span className={styles.itemTitle}>{title}</span>
            <span className={styles.itemMeta}>
              {thread.pinned && (
                <span className={styles.pinned}>
                  <PinIcon /> Pinned
                </span>
              )}
              {date.format(thread.updatedAt)}
              {note && ` · ${note}`}
            </span>
          </Link>
          <DeleteButton thread={thread} title={title} onClick={() => setConfirming(true)} />
        </>
      )}
      {fetcher.data?.ok === false && <p className={styles.failure}>{fetcher.data.message}</p>}
    </li>
  );
}

/**
 * The search box and the pinned-only switch.
 *
 * @param props - The filter and its setter.
 * @param props.filter - The filter.
 * @param props.onChange - Receives the next filter.
 * @returns The controls.
 */
function ThreadSearch({
  filter,
  onChange,
}: {
  readonly filter: ThreadFilter;
  readonly onChange: (next: ThreadFilter) => void;
}) {
  return (
    <div className={styles.controls}>
      <search className={styles.search}>
        <SearchIcon />
        <input
          type="search"
          aria-label="Search past threads"
          placeholder="Search by title"
          className={styles.searchInput}
          value={filter.text}
          onChange={(event) => onChange({ ...filter, text: event.target.value })}
        />
      </search>
      <button
        type="button"
        className={styles.chip}
        aria-pressed={filter.pinnedOnly}
        onClick={() => onChange({ ...filter, pinnedOnly: !filter.pinnedOnly })}
      >
        <PinIcon /> Pinned only
      </button>
    </div>
  );
}

/**
 * The threads that pass the filter, grouped by day, or why there are none.
 *
 * @param props - The threads and the filter.
 * @param props.threads - Every past thread, the latest first.
 * @param props.filter - The filter.
 * @returns The list.
 */
function ThreadGroups({
  threads,
  filter,
}: {
  readonly threads: readonly ThreadListItem[];
  readonly filter: ThreadFilter;
}) {
  const groups = useMemo(
    () => groupByDay(filterThreads(threads, filter), new Date()),
    [threads, filter],
  );
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (groups.length === 0) return <p className={styles.empty}>No thread matches.</p>;
  return (
    <nav className={styles.groups} aria-label="Past threads">
      {groups.map((group) => (
        <section key={group.label} className={styles.group}>
          <h3 className={styles.groupLabel}>{group.label}</h3>
          <ul className={styles.list}>
            {group.threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} date={date} />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/**
 * Past threads, behind a button: a drawer from the right (from the top on a phone) with a search,
 * a pinned-only switch, the threads grouped by day, and a way to delete each.
 *
 * @param props - The threads.
 * @param props.threads - Every past thread, the latest first.
 * @returns The button and its drawer, or nothing when there are no threads.
 */
export function ThreadsDrawer({ threads }: { readonly threads: readonly ThreadListItem[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<ThreadFilter>({ text: '', pinnedOnly: false });
  if (threads.length === 0) return null;
  return (
    <>
      <button type="button" className={styles.openButton} onClick={() => setOpen(true)}>
        <HistoryIcon />
        Past threads
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Past threads">
        <ThreadSearch filter={filter} onChange={setFilter} />
        <ThreadGroups threads={threads} filter={filter} />
      </Drawer>
    </>
  );
}
