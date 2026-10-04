/**
 * The bar under a live alert's header while changes made by hand are not saved: what changed,
 * how often it would have fired over the chart's window, which series would change state now,
 * and Discard or Activate as a new version.
 */
import type { AlertDetail } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import type { ReplayOutcome } from './data.ts';
import { changeWords, nowComparison, pastComparison } from './unsaved.ts';
import styles from './unsaved-bar.module.css';
import { useAlertChange } from './use-alert-change.ts';
import type { Tuning } from './use-tuning.ts';

/** Props of {@link UnsavedBar}. */
interface UnsavedBarProps {
  /** The alert. */
  readonly alert: AlertDetail;
  /** The page's hand tuning. */
  readonly tuning: Tuning;
  /** The chart's replay of the active version, once loaded. */
  readonly outcome: ReplayOutcome | undefined;
  /** The chart's window, such as `Last 7 days`. */
  readonly window: string;
}

/**
 * The bar, while changes are not saved.
 *
 * @param props - The alert, the tuning, the chart's replay and its window.
 * @returns The bar, or nothing.
 */
export function UnsavedBar({ alert, tuning, outcome, window }: UnsavedBarProps) {
  const { submit, busy } = useAlertChange();
  const { saved, unsaved } = tuning;
  if (!saved || !unsaved || alert.activeVersion === null) return null;
  const replay = outcome?.ok && outcome.replay.replayable ? outcome.replay : undefined;
  const past = replay && pastComparison(replay, unsaved, window);
  const next =
    Math.max(alert.latestVersion ?? 0, ...alert.versions.map((each) => each.version)) + 1;
  const basedOn = alert.activeVersion;
  return (
    <div className={styles.bar} role="status">
      <p className={styles.text}>
        <strong>Not saved:</strong> {changeWords(saved, unsaved)}.{past && ` ${past}`}{' '}
        {nowComparison(alert.series, unsaved, Date.now())}
      </p>
      <div className={styles.actions}>
        <Button disabled={busy} onClick={tuning.discard}>
          Discard
        </Button>
        <Button
          variant="dark"
          disabled={busy || tuning.dragged !== null}
          onClick={() => submit({ intent: 'activateChanges', basedOn, spec: unsaved })}
        >
          Activate as v{next}
        </Button>
      </div>
    </div>
  );
}
