import type { SnapshotSummary } from '@quanthea/shared';
import { Link, type SubmitTarget, useFetcher, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Page } from '../../ui/page.tsx';
import { dateTimeWords, rangeWords, untilWords } from '../dashboard/index.ts';
import type { RevokeIntent, RevokeOutcome } from './data.ts';
import styles from './snapshot.module.css';

/**
 * One live snapshot: what it froze, who took it and when, until when it lives, and Revoke.
 *
 * @param props - The snapshot.
 * @param props.snapshot - The snapshot.
 * @returns The row.
 */
function SnapshotRow({ snapshot }: { readonly snapshot: SnapshotSummary }) {
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
    <li className={styles.row} data-busy={busy}>
      <div className={styles.what}>
        <Link className={styles.rowTitle} to={`/s/${snapshot.id}`}>
          {snapshot.title} v{snapshot.version} · {rangeWords(snapshot.time)}
        </Link>
        <span className={styles.meta}>
          Taken by {snapshot.takenBy} on {dateTimeWords(snapshot.takenAt)} · lives{' '}
          {untilWords(snapshot.expiresAt)} · {(snapshot.bytes / 1024).toFixed(0)} KB
        </span>
        {fetcher.data?.ok === false && (
          <span className={styles.failure}>{fetcher.data.message}</span>
        )}
      </div>
      <Button variant="danger" size="small" disabled={busy} onClick={revoke}>
        Revoke
      </Button>
    </li>
  );
}

/**
 * Settings → Snapshots: every live snapshot, the newest first, with Revoke.
 *
 * @returns The screen.
 */
export function SnapshotsScreen() {
  const snapshots = useLoaderData() as readonly SnapshotSummary[];
  return (
    <Page
      title="Snapshots"
      subtitle="Dashboards frozen with their data, at links anyone signed in can open. Revoking one ends its link at once."
    >
      {snapshots.length === 0 ? (
        <p className={styles.empty}>No live snapshots.</p>
      ) : (
        <ul className={styles.list}>
          {snapshots.map((snapshot) => (
            <SnapshotRow key={snapshot.id} snapshot={snapshot} />
          ))}
        </ul>
      )}
    </Page>
  );
}
