import { Button } from '../../ui/button.tsx';
import { affectedThreadsWarning } from './access-change.ts';
import styles from './connector.module.css';
import type { AccessGuard } from './use-access-guard.ts';

/**
 * The warning before saving an access change that restricts data threads already hold: it counts
 * them, then asks to save anyway or cancel. Nothing shows while no change waits.
 *
 * @param props - The guard of the section.
 * @param props.guard - The change waiting, its count and the confirm and cancel callbacks.
 * @returns The warning, or nothing.
 */
export function AccessWarning({ guard }: { readonly guard: AccessGuard }) {
  if (guard.proposed === undefined) return null;
  if (guard.threads === undefined)
    return (
      <p className={styles.cardNote} role="status">
        Counting the threads this change affects…
      </p>
    );
  return (
    <div className={styles.accessWarning} role="alert">
      <p className={styles.accessWarningText}>{affectedThreadsWarning(guard.threads)}</p>
      <div className={styles.accessWarningActions}>
        <Button size="small" variant="primary" onClick={guard.confirm}>
          Save anyway
        </Button>
        <Button size="small" onClick={guard.cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
