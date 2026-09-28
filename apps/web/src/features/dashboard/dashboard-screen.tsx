import { useState } from 'react';
import { Link, useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { LockIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { DashboardCanvas } from './canvas.tsx';
import styles from './dashboard.module.css';
import { DashboardSidebar } from './dashboard-sidebar.tsx';
import type { DashboardData } from './data.ts';

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
 * The top of the screen: where it sits, its title, its version and whether it is pinned.
 *
 * @param props - The dashboard and the version shown.
 * @returns The header.
 */
function DashboardHeader({ version }: DashboardData) {
  const pinned = version.pinnedAt !== null;
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <nav aria-label="Breadcrumb" className={styles.crumbs}>
          <Link to="/library">Library</Link> / {pinned ? 'pinned' : 'draft'}
        </nav>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{version.spec.title}</h1>
          <Pill mono tone={pinned ? 'neutral' : 'draft'}>
            {pinned && <LockIcon />}
            {pinned ? `pinned · v${version.version} · read-only` : `draft · v${version.version}`}
          </Pill>
        </div>
      </div>
      <CopyLinkButton />
    </header>
  );
}

/**
 * A dashboard: its variables, its panels running saved queries with no model involved, and its
 * sidebar.
 *
 * @returns The screen.
 */
export function DashboardScreen() {
  const loaded = useLoaderData() as DashboardData;
  const { dashboard, version } = loaded;
  return (
    <div className={styles.screen}>
      <DashboardHeader {...loaded} />
      <div className={styles.body}>
        <div className={styles.main}>
          <DashboardCanvas
            banner
            dashboardId={dashboard.id}
            version={version.version}
            spec={version.spec}
          />
        </div>
        <DashboardSidebar {...loaded} />
      </div>
    </div>
  );
}
