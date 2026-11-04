import type { TurnLimit } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import { InfoIcon } from '../../ui/icons.tsx';
import styles from './cards.module.css';

/** Props of {@link LimitCard}. */
export interface LimitCardProps {
  /** The limit the turn paused at. */
  readonly limit: TurnLimit;
  /** Whether nothing came after it, so the turn may still be continued. */
  readonly answerable: boolean;
  /** Whether a run or a decision is on its way. */
  readonly busy: boolean;
  /** Continues the turn, with fresh counts. */
  readonly onContinue: () => void;
}

/**
 * What the turn spent when it paused, such as `25 tool calls` or `about 1,000,000 tokens`.
 *
 * @param limit - The limit.
 * @returns The phrase.
 */
export function limitPhrase(limit: TurnLimit): string {
  if (limit.kind === 'calls') return `${limit.used} tool ${limit.used === 1 ? 'call' : 'calls'}`;
  return `${limit.used.toLocaleString('en')} tokens`;
}

/**
 * A turn that paused at a limit of the model settings: what it spent, and Continue while nothing
 * came after it.
 *
 * @param props - The limit and the thread's action.
 * @returns The card.
 */
export function LimitCard({ limit, answerable, busy, onContinue }: LimitCardProps) {
  const title = `Paused after ${limitPhrase(limit)}`;
  return (
    <section className={styles.folded} aria-label={title}>
      <InfoIcon />
      <span>{title}. The limit is set in Settings → Model.</span>
      {answerable && (
        <Button variant="primary" size="small" disabled={busy} onClick={onContinue}>
          Continue
        </Button>
      )}
    </section>
  );
}
