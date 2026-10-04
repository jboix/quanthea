import { Link } from 'react-router';
import { BellIcon, VariantIcon } from '../../ui/icons.tsx';
import type { ParentDashboard, SeedPanel } from './data.ts';
import styles from './thread.module.css';

/**
 * Where a draft that started as a copy came from: the parent and the version copied, and that
 * the original stays as it is.
 *
 * @param props - The parent.
 * @param props.parent - The dashboard the draft was copied from.
 * @returns The banner.
 */
export function LineageBanner({ parent }: { readonly parent: ParentDashboard }) {
  return (
    <div className={styles.lineage} role="note">
      <VariantIcon />
      <div>
        <p>
          Variant of{' '}
          {parent.title === null ? (
            'a dashboard deleted since'
          ) : (
            <Link to={`/d/${parent.dashboardId}`}>{parent.title}</Link>
          )}{' '}
          · v{parent.version}
        </p>
        <p className={styles.lineageNote}>Starts from a copy. The original stays as it is.</p>
      </div>
    </div>
  );
}

/**
 * The panel an alert thread started from: its title, its dashboard and version, and that the agent
 * reads its query.
 *
 * @param props - The panel.
 * @param props.origin - The panel and its dashboard.
 * @returns The banner.
 */
export function SeedBanner({ origin }: { readonly origin: SeedPanel }) {
  const path = `/d/${origin.dashboardId}/v/${origin.version}#panel-${encodeURIComponent(origin.panelId)}`;
  return (
    <div className={styles.lineage} role="note">
      <BellIcon />
      <div>
        <p>
          From the panel <Link to={path}>{origin.panelTitle}</Link> on {origin.dashboardTitle} · v
          {origin.version}
        </p>
        <p className={styles.lineageNote}>
          The agent reads its query. Say when the alert should fire.
        </p>
      </div>
    </div>
  );
}
