import type { ThreadListItem } from '@quanthea/shared';
import { useMemo, useState } from 'react';
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Drawer } from '../../ui/drawer.tsx';
import {
  BellIcon,
  BinIcon,
  DashboardIcon,
  HistoryIcon,
  PinIcon,
  SearchIcon,
} from '../../ui/icons.tsx';
import type { NewThreadIntent, ThreadOutcome } from './data.ts';
import {
  binBlocker,
  filterThreads,
  groupByDay,
  type ThreadFilter,
  type ThreadStatus,
  threadStatuses,
  untitled,
} from './thread-list.ts';
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
 * The button that moves a thread to the bin. A thread whose dashboard is pinned, or whose alert is
 * active, can't go, so its button says why instead.
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
  const blocker = binBlocker(thread);
  return (
    <button
      type="button"
      className={styles.delete}
      aria-label={blocker ? `${blocker}: ${title}` : `Move ${title} to the bin`}
      title={blocker ?? 'Move to the bin'}
      disabled={blocker !== null}
      onClick={onClick}
    >
      <BinIcon />
    </button>
  );
}

/**
 * What a thread makes, as an icon: a bell for an alert, tiles for a dashboard.
 *
 * @param props - The kind.
 * @param props.kind - What the thread makes.
 * @returns The icon, named for screen readers.
 */
function KindIcon({ kind }: { readonly kind: ThreadListItem['kind'] }) {
  const words = kind === 'alert' ? 'An alert' : 'A dashboard';
  return (
    <span className={styles.kind} title={words} role="img" aria-label={words}>
      {kind === 'alert' ? <BellIcon /> : <DashboardIcon />}
    </span>
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
            <span className={styles.itemTitle}>
              <KindIcon kind={thread.kind} />
              {title}
            </span>
            <span className={styles.itemMeta}>
              {thread.ownerName && <span className={styles.owner}>{thread.ownerName}</span>}
              {thread.pinned && (
                <span className={styles.pinned}>
                  <PinIcon /> Pinned
                </span>
              )}
              {thread.alertActive && (
                <span className={styles.pinned}>
                  <BellIcon /> Active
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

/** What each status says. */
const statusLabels: Readonly<Record<ThreadStatus, string>> = {
  all: 'All',
  live: 'Live',
  drafts: 'Drafts',
};

/** What each status means, on hover. */
const statusTitles: Readonly<Record<ThreadStatus, string>> = {
  all: 'Every thread',
  live: 'Its dashboard is pinned, or its alert is active',
  drafts: 'No pinned dashboard and no active alert',
};

/**
 * One status at a time: All, Live or Drafts.
 *
 * @param props - The filter and its setter.
 * @param props.filter - The filter.
 * @param props.onChange - Receives the next filter.
 * @returns The chips.
 */
function StatusChips({
  filter,
  onChange,
}: {
  readonly filter: ThreadFilter;
  readonly onChange: (next: ThreadFilter) => void;
}) {
  return (
    <fieldset className={styles.statuses}>
      <legend className={styles.visuallyHidden}>Show</legend>
      {threadStatuses.map((status) => (
        <button
          key={status}
          type="button"
          className={styles.chip}
          aria-pressed={filter.status === status}
          title={statusTitles[status]}
          onClick={() => onChange({ ...filter, status })}
        >
          {statusLabels[status]}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * The search box, the status chips, and for admins the everyone's switch.
 *
 * @param props - The filter, its setter, and whether others' threads are on offer.
 * @param props.filter - The filter.
 * @param props.onChange - Receives the next filter.
 * @param props.showEveryone - Whether to offer others' threads, as for admins.
 * @returns The controls.
 */
function ThreadSearch({
  filter,
  onChange,
  showEveryone,
}: {
  readonly filter: ThreadFilter;
  readonly onChange: (next: ThreadFilter) => void;
  readonly showEveryone: boolean;
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
      <StatusChips filter={filter} onChange={onChange} />
      {showEveryone && (
        <button
          type="button"
          className={styles.chip}
          aria-pressed={filter.everyone}
          onClick={() => onChange({ ...filter, everyone: !filter.everyone })}
        >
          Everyone’s
        </button>
      )}
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
  const [filter, setFilter] = useState<ThreadFilter>({
    text: '',
    status: 'all',
    everyone: false,
  });
  if (threads.length === 0) return null;
  return (
    <>
      <button type="button" className={styles.openButton} onClick={() => setOpen(true)}>
        <HistoryIcon />
        Past threads
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Past threads">
        <ThreadSearch
          filter={filter}
          onChange={setFilter}
          showEveryone={threads.some((thread) => thread.ownerName !== null)}
        />
        <ThreadGroups threads={threads} filter={filter} />
      </Drawer>
    </>
  );
}
