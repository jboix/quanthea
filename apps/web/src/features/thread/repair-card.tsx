import type { Repair } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import { CheckIcon, WarningIcon } from '../../ui/icons.tsx';
import styles from './cards.module.css';
import repairStyles from './repair-card.module.css';
import { repairTitle, stillFailing } from './repairs.ts';

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
 * What failed, by panel, and what is wrong with the dashboard as a whole.
 *
 * @param props - The try.
 * @param props.repair - The try.
 * @returns The lines.
 */
function RepairLines({ repair }: { readonly repair: Repair }) {
  return (
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
  );
}

/**
 * The try that stopped a build: what still fails in one sentence, Try again while nothing came
 * after it, and each panel's problems folded under "What failed".
 *
 * @param props - The try and the thread's action.
 * @returns The card.
 */
function StoppedCard({ repair, answerable, busy, onTryAgain }: RepairCardProps) {
  const title = repairTitle(repair);
  return (
    <section className={repairStyles.repair} data-outcome="exhausted" aria-label={title}>
      <h4 className={repairStyles.repairHead}>
        <WarningIcon />
        {title}
      </h4>
      <p className={repairStyles.summary}>{stillFailing(repair)}</p>
      {answerable && (
        <div className={repairStyles.actions}>
          <Button variant="primary" size="small" disabled={busy} onClick={onTryAgain}>
            Try again
          </Button>
          <span className={styles.hint}>or reply to change the request</span>
        </div>
      )}
      <details className={repairStyles.whatFailed}>
        <summary>What failed</summary>
        <RepairLines repair={repair} />
      </details>
    </section>
  );
}

/**
 * One try of the repair loop: what failed and why, by panel; when the attempts ran out, what
 * still fails and Try again; when a later try worked, one green line.
 *
 * @param props - The try and the thread's action.
 * @returns The card.
 */
export function RepairCard(props: RepairCardProps) {
  const { repair } = props;
  if (repair.outcome === 'exhausted') return <StoppedCard {...props} />;
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
      <RepairLines repair={repair} />
    </section>
  );
}
