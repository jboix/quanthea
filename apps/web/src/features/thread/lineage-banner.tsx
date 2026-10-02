import { Link } from 'react-router';
import { VariantIcon } from '../../ui/icons.tsx';
import type { ParentDashboard } from './data.ts';
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
