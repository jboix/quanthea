/**
 * The Snapshot menu of the dashboard header, for editors: take a snapshot of the version as shown,
 * copy its link, and see and revoke the dashboard's live snapshots.
 */
import type { SnapshotLifetime, SnapshotSummary } from '@quanthea/shared';
import { useEffect, useState } from 'react';
import { Link, type SubmitTarget, useFetcher, useSearchParams } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { CameraIcon } from '../../ui/icons.tsx';
import { Popover } from '../../ui/popover.tsx';
import { Select } from '../../ui/select.tsx';
import styles from './dashboard.module.css';
import type { DashboardData } from './data.ts';
import type { Loaded } from './loaded.ts';
import { hiddenMarkersOf } from './marker-sets.ts';
import type { SnapshotIntent } from './snapshot-data.ts';
import { lifetimeChoices, rangeWords, untilWords } from './snapshot-words.ts';
import { choicesFromSearch } from './view-state.ts';

/**
 * Submits snapshot intents to the dashboard's action, and keeps the last outcome.
 *
 * @returns The submit function, whether one is on its way, and the last outcome.
 */
function useSnapshotIntent() {
  const fetcher = useFetcher<Loaded<SnapshotSummary | null>>();
  const submit = (intent: SnapshotIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  return { submit, busy: fetcher.state !== 'idle', outcome: fetcher.data };
}

/**
 * The link of a snapshot, with a button that copies it.
 *
 * @param props - The snapshot.
 * @param props.snapshot - The snapshot just taken.
 * @returns The link and the button.
 */
function TakenLink({ snapshot }: { readonly snapshot: SnapshotSummary }) {
  const [copied, setCopied] = useState(false);
  const href = `${window.location.origin}/s/${snapshot.id}`;
  const copy = async () => {
    await navigator.clipboard.writeText(href);
    setCopied(true);
  };
  return (
    <div className={styles.snapshotTaken}>
      <span>
        <Link to={`/s/${snapshot.id}`}>Snapshot taken</Link>, it lives{' '}
        {untilWords(snapshot.expiresAt)}.
      </span>
      <Button size="small" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  );
}

/**
 * Takes a snapshot of the version shown, with the time range, variables and hidden markers in the
 * address, for the lifetime picked.
 *
 * @param props - The dashboard and the version shown.
 * @returns The form.
 */
function TakeSnapshot({ version }: DashboardData) {
  const [search] = useSearchParams();
  const [lifetime, setLifetime] = useState<SnapshotLifetime>('7d');
  const { submit, busy, outcome } = useSnapshotIntent();
  const take = () => {
    const choices = choicesFromSearch(search, version.spec);
    const hiddenMarkers = [...hiddenMarkersOf(search, version.spec)];
    submit({ intent: 'snapshot', version: version.version, lifetime, ...choices, hiddenMarkers });
  };
  return (
    <div className={styles.snapshotForm}>
      <p className={styles.muted}>
        Freezes v{version.version} with the data it shows now, at a link anyone signed in can open.
        Opening it runs no query.
      </p>
      <Select
        label="Keep it"
        compact
        options={lifetimeChoices}
        value={lifetime}
        onChange={(event) => setLifetime(event.target.value as SnapshotLifetime)}
      />
      <Button variant="primary" disabled={busy} onClick={take}>
        {busy ? 'Running the panels…' : 'Take snapshot'}
      </Button>
      {outcome?.ok === false && <p className={styles.error}>{outcome.message}</p>}
      {outcome?.ok && outcome.value && <TakenLink snapshot={outcome.value} />}
    </div>
  );
}

/**
 * One live snapshot: its range, who took it and until when it lives, a link, and Revoke.
 *
 * @param props - The snapshot and the dashboard's time zone.
 * @param props.snapshot - The snapshot.
 * @param props.timeZone - The dashboard's time zone, if it sets one.
 * @returns The row.
 */
function SnapshotRow({
  snapshot,
  timeZone,
}: {
  readonly snapshot: SnapshotSummary;
  readonly timeZone: string | undefined;
}) {
  const { submit, busy, outcome } = useSnapshotIntent();
  return (
    <li className={styles.snapshotRow} data-busy={busy}>
      <Link className={styles.snapshotLink} to={`/s/${snapshot.id}`}>
        {rangeWords(snapshot.time, timeZone)}
      </Link>
      <span className={styles.historyWhen}>
        v{snapshot.version} · by {snapshot.takenBy} · {untilWords(snapshot.expiresAt)}
      </span>
      <Button
        size="small"
        variant="danger"
        disabled={busy}
        onClick={() => submit({ intent: 'revoke', snapshotId: snapshot.id })}
      >
        Revoke
      </Button>
      {outcome?.ok === false && <span className={styles.error}>{outcome.message}</span>}
    </li>
  );
}

/**
 * The dashboard's live snapshots, loaded when the menu opens and again after each change.
 *
 * @param props - The dashboard and the version shown.
 * @returns The list.
 */
function LiveSnapshots({ dashboard, version }: DashboardData) {
  const fetcher = useFetcher<Loaded<SnapshotSummary[]>>();
  const { load } = fetcher;
  useEffect(() => {
    void load(`/d/${dashboard.id}/snapshots`);
  }, [load, dashboard.id]);
  const loaded = fetcher.data;
  if (!loaded) return <p className={styles.muted}>Loading…</p>;
  if (!loaded.ok) return <p className={styles.error}>{loaded.message}</p>;
  if (loaded.value.length === 0) return <p className={styles.muted}>No live snapshots.</p>;
  return (
    <ul className={styles.snapshots}>
      {loaded.value.map((snapshot) => (
        <SnapshotRow key={snapshot.id} snapshot={snapshot} timeZone={version.spec.timezone} />
      ))}
    </ul>
  );
}

/**
 * The Snapshot button of the header, which opens the menu.
 *
 * @param props - The dashboard and the version shown.
 * @returns The popover.
 */
export function SnapshotPopover(props: DashboardData) {
  return (
    <Popover
      label="Snapshots"
      shape="button"
      align="end"
      trigger={
        <>
          <CameraIcon /> Snapshot
        </>
      }
    >
      <SnapshotMenu {...props} />
    </Popover>
  );
}

/**
 * What the Snapshot menu holds: the form, and the live snapshots.
 *
 * @param props - The dashboard and the version shown.
 * @returns The menu's content.
 */
export function SnapshotMenu(props: DashboardData) {
  return (
    <div className={styles.popoverBody}>
      <TakeSnapshot {...props} />
      <h2 className={styles.sideHeading}>Live snapshots</h2>
      <LiveSnapshots {...props} />
    </div>
  );
}
