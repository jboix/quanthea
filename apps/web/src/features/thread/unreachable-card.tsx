import { Button } from '../../ui/button.tsx';
import { WarningIcon } from '../../ui/icons.tsx';
import styles from './cards.module.css';
import repairStyles from './repair-card.module.css';

/** Props of {@link UnreachableCard}. */
export interface UnreachableCardProps {
  /** The connectors that did not answer. */
  readonly connectors: readonly string[];
  /** Whether nothing came after it, so Try again may start the build. */
  readonly answerable: boolean;
  /** Whether a run or a decision is on its way. */
  readonly busy: boolean;
  /** Starts the build again. */
  readonly onTryAgain: () => void;
}

/**
 * The connectors named in a sentence, such as `orders, logs and metrics`.
 *
 * @param connectors - The names.
 * @returns The phrase.
 */
export function connectorList(connectors: readonly string[]): string {
  if (connectors.length < 2) return connectors.join('');
  return `${connectors.slice(0, -1).join(', ')} and ${connectors.at(-1)}`;
}

/**
 * A build that did not start because connectors it reads do not answer: which ones, and Try
 * again while nothing came after it.
 *
 * @param props - The connectors and the thread's action.
 * @returns The card.
 */
export function UnreachableCard({
  connectors,
  answerable,
  busy,
  onTryAgain,
}: UnreachableCardProps) {
  const verb = connectors.length === 1 ? 'does' : 'do';
  const title = `${connectorList(connectors)} ${verb} not answer`;
  return (
    <section className={repairStyles.repair} data-outcome="exhausted" aria-label={title}>
      <h4 className={repairStyles.repairHead}>
        <WarningIcon />
        {title}
      </h4>
      <p className={repairStyles.repairLines}>
        The build has not started. An admin can test a connector under Connectors.
      </p>
      {answerable && (
        <div className={styles.planActions}>
          <Button variant="primary" size="small" disabled={busy} onClick={onTryAgain}>
            Try again
          </Button>
          <span className={styles.hint}>once it answers again</span>
        </div>
      )}
    </section>
  );
}
