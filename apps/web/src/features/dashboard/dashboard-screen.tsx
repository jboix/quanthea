import { useEffect, useState } from 'react';
import { Link, useLoaderData, useLocation } from 'react-router';
import { Button, buttonClassName } from '../../ui/button.tsx';
import { LockIcon, ThreadsIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { DashboardCanvas } from './canvas.tsx';
import styles from './dashboard.module.css';
import { AboutPopover, HistoryPopover } from './dashboard-about.tsx';
import type { DashboardData } from './data.ts';
import { useCanEdit } from './use-can-edit.ts';
import { versionNote } from './version-note.ts';

/**
 * Copies the page's address, and says so for two seconds.
 *
 * @returns The button.
 */
function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</Button>;
}

/**
 * The link to the thread that edits the dashboard, for editors, while the thread exists.
 *
 * @param props - The thread.
 * @param props.threadId - The thread, if it still exists.
 * @returns The link, or nothing.
 */
function ThreadLink({ threadId }: { readonly threadId: string | null }) {
  const canEdit = useCanEdit();
  if (threadId === null || !canEdit) return null;
  return (
    <Link to={`/threads/${threadId}`} className={buttonClassName('secondary')}>
      <ThreadsIcon /> Open thread
    </Link>
  );
}

/**
 * The top of the screen: where it sits, its title with what it is about, its version and whether
 * it is pinned, and its history, its thread and its link.
 *
 * @param props - The dashboard and the version shown.
 * @returns The header.
 */
function DashboardHeader(props: DashboardData) {
  const { version, dashboard } = props;
  const shown = version.version === dashboard.pinnedVersion;
  const note = versionNote(version, dashboard.pinnedVersion);
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <nav aria-label="Breadcrumb" className={styles.crumbs}>
          <Link to="/library">Library</Link> /{' '}
          {dashboard.pinnedVersion === null ? 'not pinned' : 'pinned'}
        </nav>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{version.spec.title}</h1>
          <AboutPopover {...props} />
          <Pill mono tone={version.pinnedAt === null ? 'draft' : 'neutral'}>
            {shown && <LockIcon />}
            {`v${version.version} · ${version.pinnedAt === null ? 'draft' : note}`}
          </Pill>
        </div>
      </div>
      <div className={styles.headerActions}>
        <HistoryPopover {...props} />
        <ThreadLink threadId={dashboard.threadId} />
        <CopyLinkButton />
      </div>
    </header>
  );
}

/**
 * Scrolls to the panel a link names in its hash, such as `#panel-errors`, as the library's
 * matching panels do.
 */
function useScrollToPanel(): void {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '') return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'center' });
  }, [hash]);
}

/**
 * A dashboard: its variables, and its panels running saved queries with no model involved.
 *
 * @returns The screen.
 */
export function DashboardScreen() {
  useScrollToPanel();
  const loaded = useLoaderData() as DashboardData;
  const { dashboard, version } = loaded;
  return (
    <div className={styles.screen}>
      <DashboardHeader {...loaded} />
      <div className={styles.body}>
        <div className={styles.main}>
          <DashboardCanvas
            refreshable
            dashboardId={dashboard.id}
            version={version.version}
            spec={version.spec}
          />
        </div>
      </div>
    </div>
  );
}
