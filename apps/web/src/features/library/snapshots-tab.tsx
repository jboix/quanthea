import type { SnapshotFilter, SnapshotSummary } from '@quanthea/shared';
import { useState } from 'react';
import { Link, type SubmitTarget, useFetcher, useSearchParams } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { useCanEdit } from '../dashboard/index.ts';
import styles from './library.module.css';
import { SearchBox } from './search-box.tsx';
import {
  type RevokeIntent,
  type RevokeOutcome,
  type SnapshotsData,
  snapshotPageSize,
} from './snapshot-data.ts';
import { expiryWords, filterChoices, periodWords, takenWords } from './snapshot-words.ts';

/**
 * The filter chips: all, expiring this week, kept until revoked. One is on at a time.
 *
 * @param props - The filter on.
 * @param props.filter - The filter in the URL.
 * @returns The chips.
 */
function FilterChips({ filter }: { readonly filter: SnapshotFilter }) {
  const [params, setParams] = useSearchParams();
  const choose = (value: SnapshotFilter) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('filter');
    else next.set('filter', value);
    next.delete('limit');
    setParams(next, { replace: true, preventScrollReset: true });
  };
  return (
    <fieldset className={styles.chips}>
      <legend className={styles.visuallyHidden}>Filter</legend>
      {filterChoices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className={styles.chip}
          aria-pressed={choice.value === filter}
          onClick={() => choose(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * Revoke, which asks first: the link stops working at once for everyone.
 *
 * @param props - The revoke callback and whether one is on its way.
 * @param props.onRevoke - Revokes the snapshot.
 * @param props.busy - Whether a revoke is on its way.
 * @returns The button, or the question with its buttons.
 */
function RevokeControl({
  onRevoke,
  busy,
}: {
  readonly onRevoke: () => void;
  readonly busy: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button size="small" disabled={busy} onClick={() => setAsking(true)}>
        Revoke
      </Button>
    );
  return (
    <div className={styles.confirm}>
      <span>Revoke this snapshot? Its link stops working at once.</span>
      <Button size="small" variant="danger" disabled={busy} onClick={onRevoke}>
        Revoke
      </Button>
      <Button size="small" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </div>
  );
}

/**
 * One live snapshot: the dashboard and version, the frozen period, who took it and when, until
 * when it lives, and Revoke for editors.
 *
 * @param props - The snapshot.
 * @param props.snapshot - The snapshot.
 * @returns The row.
 */
function SnapshotRow({ snapshot }: { readonly snapshot: SnapshotSummary }) {
  const canEdit = useCanEdit();
  const fetcher = useFetcher<RevokeOutcome>();
  const revoke = () => {
    const intent: RevokeIntent = { snapshotId: snapshot.id };
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  };
  const busy = fetcher.state !== 'idle';
  return (
    <li className={styles.snapshot} data-busy={busy}>
      <div className={styles.snapshotWhat}>
        <Link className={styles.snapshotTitle} to={`/s/${snapshot.id}`}>
          {snapshot.title} <span className={styles.version}>v{snapshot.version}</span>
        </Link>
        <span className={styles.period}>{periodWords(snapshot.time)}</span>
        <span className={styles.meta}>
          {takenWords(snapshot)} · {expiryWords(snapshot.expiresAt)}
        </span>
        {fetcher.data?.ok === false && <span className={styles.error}>{fetcher.data.message}</span>}
      </div>
      {canEdit && <RevokeControl onRevoke={revoke} busy={busy} />}
    </li>
  );
}

/**
 * "Show more", when more snapshots match than the list shows.
 *
 * @param props - The tab's data.
 * @param props.data - The loader data.
 * @returns The link, or nothing when every match shows.
 */
function ShowMore({ data }: { readonly data: SnapshotsData }) {
  const [params] = useSearchParams();
  if (data.snapshots.length >= data.total) return null;
  const next = new URLSearchParams(params);
  next.set('limit', String(data.limit + snapshotPageSize));
  return (
    <Link className={styles.more} to={`?${next}`} replace preventScrollReset>
      Show more ({data.total - data.snapshots.length} left)
    </Link>
  );
}

/**
 * What the list says when nothing is found.
 *
 * @param props - Whether the person searched or filtered.
 * @param props.narrowed - `true` when a search or a filter is on.
 * @returns The note.
 */
function EmptyNote({ narrowed }: { readonly narrowed: boolean }) {
  return (
    <p className={styles.empty}>
      {narrowed
        ? 'No snapshot matches. Try fewer words or another filter.'
        : 'No live snapshots. Editors take one from a dashboard’s Share menu.'}
    </p>
  );
}

/**
 * The Snapshots tab: search the live snapshots by dashboard, period or taker, filter them, open
 * one, and, for editors, revoke one.
 *
 * @param props - The tab's data.
 * @param props.data - The loader data.
 * @returns The tab's content.
 */
export function SnapshotsTab({ data }: { readonly data: SnapshotsData }) {
  return (
    <>
      <SearchBox
        q={data.q}
        count={data.total}
        label="Search the snapshots"
        placeholder="Dashboard, period or taker"
      />
      <FilterChips filter={data.filter} />
      {data.snapshots.length === 0 ? (
        <EmptyNote narrowed={data.q !== '' || data.filter !== 'all'} />
      ) : (
        <ul className={styles.snapshots}>
          {data.snapshots.map((snapshot) => (
            <SnapshotRow key={snapshot.id} snapshot={snapshot} />
          ))}
        </ul>
      )}
      <ShowMore data={data} />
    </>
  );
}
