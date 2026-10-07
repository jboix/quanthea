import { Button } from '../../ui/button.tsx';
import { affectedThreadsWarning, uncountedWarning } from './access-change.ts';
import styles from './connector.module.css';
import type { AccessGuard } from './use-access-guard.ts';

/**
 * The text of the warning: the count, or why the threads could not be counted.
 *
 * @param guard - The guard of the section, with a count or a failure.
 * @returns The text.
 */
function warningText(guard: AccessGuard): string {
  if (guard.failure !== undefined) return uncountedWarning(guard.failure);
  return affectedThreadsWarning(guard.threads ?? 0);
}

/**
 * The warning before saving an access change that restricts data threads already hold. While it
 * counts them it offers Cancel; once counted, or when the count fails, it asks to save anyway or
 * cancel. Nothing shows while no change waits.
 *
 * @param props - The guard of the section.
 * @param props.guard - The change waiting, its count and the confirm and cancel callbacks.
 * @returns The warning, or nothing.
 */
export function AccessWarning({ guard }: { readonly guard: AccessGuard }) {
  if (guard.proposed === undefined) return null;
  const counting = guard.threads === undefined && guard.failure === undefined;
  return (
    <div className={styles.accessWarning} role={counting ? 'status' : 'alert'}>
      <p className={styles.accessWarningText}>
        {counting ? 'Counting the threads this change affects…' : warningText(guard)}
      </p>
      <div className={styles.accessWarningActions}>
        {!counting && (
          <Button size="small" variant="primary" onClick={guard.confirm}>
            Save anyway
          </Button>
        )}
        <Button size="small" onClick={guard.cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
