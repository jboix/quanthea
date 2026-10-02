import type { Repair } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import { CheckIcon, WarningIcon } from '../../ui/icons.tsx';
import styles from './cards.module.css';
import repairStyles from './repair-card.module.css';
import { repairTitle } from './repairs.ts';

/** Props of {@link RepairCard}. */
export interface RepairCardProps {
  /** The try. */
  readonly repair: Repair;
  /** Whether it ends the latest answer, so Try again may start a new run. */
  readonly answerable: boolean;
  /** Whether a run or a decision is on its way. */
  readonly busy: boolean;
  /** Starts a new run with fresh attempts. */
  readonly onTryAgain: () => void;
}

/**
 * One try of the repair loop: what failed and why, by panel; when the attempts ran out, Try
 * again; when a later try worked, one green line.
 *
 * @param props - The try and the thread's action.
 * @returns The card.
 */
export function RepairCard({ repair, answerable, busy, onTryAgain }: RepairCardProps) {
  const title = repairTitle(repair);
  if (repair.outcome === 'repaired') {
    return (
      <div className={styles.folded} data-status="approved" role="status">
        <CheckIcon />
        <span>{title}</span>
      </div>
    );
  }
  return (
    <section className={repairStyles.repair} data-outcome={repair.outcome} aria-label={title}>
      <h4 className={repairStyles.repairHead}>
        <WarningIcon />
        {title}
      </h4>
      <ul className={repairStyles.repairLines}>
        {repair.panels.map((panel) => (
          <li key={panel.id}>
            <strong>{panel.title}</strong>: {panel.problems.join('; ') || 'it does not work'}
          </li>
        ))}
        {repair.issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
      {repair.outcome === 'exhausted' && answerable && (
        <div className={styles.planActions}>
          <Button variant="primary" size="small" disabled={busy} onClick={onTryAgain}>
            Try again
          </Button>
          <span className={styles.hint}>or reply to change the request</span>
        </div>
      )}
    </section>
  );
}
