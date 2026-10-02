import type { Snapshot } from '@quanthea/shared';
import { Link, useLoaderData } from 'react-router';
import { Banner } from '../../ui/banner.tsx';
import { CameraIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { dateTimeWords, FrozenCanvas, untilWords } from '../dashboard/index.ts';
import styles from './snapshot.module.css';

/**
 * What the snapshot is: of which dashboard and version, who took it and when, that nothing runs,
 * and until when it lives.
 *
 * @param props - The snapshot.
 * @param props.snapshot - The snapshot.
 * @returns The banner.
 */
function SnapshotNote({ snapshot }: { readonly snapshot: Snapshot }) {
  return (
    <Banner tone="info" icon={<CameraIcon />}>
      A snapshot of{' '}
      <Link to={`/d/${snapshot.dashboardId}/v/${snapshot.version}`}>
        {snapshot.title} v{snapshot.version}
      </Link>
      , taken by {snapshot.takenBy} on {dateTimeWords(snapshot.takenAt)}. It shows the data as it
      was then: no query runs and no model is called. It lives {untilWords(snapshot.expiresAt)}.
    </Banner>
  );
}

/**
 * A snapshot: a dashboard version frozen with the results it showed. The time range and the
 * variables can't change; the markers can be shown or hidden.
 *
 * @returns The screen.
 */
export function SnapshotScreen() {
  const snapshot = useLoaderData() as Snapshot;
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <nav aria-label="Breadcrumb" className={styles.crumbs}>
          <Link to={`/d/${snapshot.dashboardId}`}>Dashboard</Link> / snapshot
        </nav>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{snapshot.spec.title}</h1>
          <Pill mono tone="neutral">
            <CameraIcon />
            {`snapshot · v${snapshot.version}`}
          </Pill>
        </div>
      </header>
      <SnapshotNote snapshot={snapshot} />
      <div className={styles.main}>
        <FrozenCanvas
          spec={snapshot.spec}
          panels={snapshot.panels}
          time={snapshot.time}
          variables={snapshot.variables}
          hiddenMarkers={snapshot.hiddenMarkers}
        />
      </div>
    </div>
  );
}
