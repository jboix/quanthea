import { useEffect, useState } from 'react';
import { Link, useLoaderData, useLocation } from 'react-router';
import { LockIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { marksOnVersion, type OpenAnswer } from './ask-marks.ts';
import { DashboardCanvas } from './canvas.tsx';
import styles from './dashboard.module.css';
import { AboutPopover } from './dashboard-about.tsx';
import { type AskAction, HeaderActions } from './dashboard-actions.tsx';
import type { DashboardData } from './data.ts';
import { SidePanel, type SideTab } from './side-panel.tsx';
import { versionNote } from './version-note.ts';

/**
 * The top of the screen: where it sits, its title with what it is about, its version and whether
 * it is pinned, and its history, its thread and its link.
 *
 * @param props - The dashboard, the version shown, and the way into the Ask tab.
 * @returns The header.
 */
function DashboardHeader(props: DashboardData & AskAction) {
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
      <HeaderActions {...props} />
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
 * A dashboard: its variables, and its panels running saved queries with no model involved. On a
 * pinned version, Ask about this opens the side panel's Ask tab; the answer open there marks the
 * panels it cites, in the page only.
 *
 * @returns The screen.
 */
export function DashboardScreen() {
  useScrollToPanel();
  const loaded = useLoaderData() as DashboardData;
  const { dashboard, version } = loaded;
  const [side, setSide] = useState<SideTab | null>(null);
  const [open, setOpen] = useState<OpenAnswer | undefined>();
  // Questions are about what everyone may see: a pinned version of a pinned dashboard.
  const askable = dashboard.pinnedVersion !== null && version.pinnedAt !== null;
  const shownSide = askable ? side : null;
  const marks = shownSide === 'ask' ? marksOnVersion(open, version.version) : undefined;
  const onAsk = askable ? () => setSide('ask') : undefined;
  return (
    <div className={styles.screen}>
      <DashboardHeader {...loaded} onAsk={onAsk} asking={shownSide === 'ask'} />
      <div className={styles.body} data-side={shownSide !== null}>
        <div className={styles.main}>
          <DashboardCanvas
            refreshable
            dashboardId={dashboard.id}
            version={version.version}
            spec={version.spec}
            answerMarks={marks}
          />
        </div>
        {shownSide && (
          <SidePanel
            {...loaded}
            tab={shownSide}
            onTab={setSide}
            onClose={() => setSide(null)}
            onOpenAnswer={setOpen}
          />
        )}
      </div>
    </div>
  );
}
