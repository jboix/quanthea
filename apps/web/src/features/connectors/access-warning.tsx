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

/** Props of {@link ChangeWarning}. */
interface ChangeWarningProps {
  /** Whether what the change touches is still being counted. */
  readonly counting: boolean;
  /** What to say while counting. */
  readonly countingText: string;
  /** What the change touches, once counted or once the count failed. */
  readonly text: string;
  /** Saves the change all the same. */
  readonly onConfirm: () => void;
  /** Drops the change. */
  readonly onCancel: () => void;
}

/**
 * The warning before saving a change that touches what people already have. While it counts it
 * offers Cancel; once counted, or when the count fails, it asks to save anyway or cancel.
 *
 * @param props - The state of the count, the texts and the callbacks.
 * @returns The warning.
 */
export function ChangeWarning(props: ChangeWarningProps) {
  const { counting, countingText, text, onConfirm, onCancel } = props;
  return (
    <div className={styles.accessWarning} role={counting ? 'status' : 'alert'}>
      <p className={styles.accessWarningText}>{counting ? countingText : text}</p>
      <div className={styles.accessWarningActions}>
        {!counting && (
          <Button size="small" variant="primary" onClick={onConfirm}>
            Save anyway
          </Button>
        )}
        <Button size="small" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The warning before saving an access change that restricts data threads already hold. Nothing
 * shows while no change waits.
 *
 * @param props - The guard of the section.
 * @param props.guard - The change waiting, its count and the confirm and cancel callbacks.
 * @returns The warning, or nothing.
 */
export function AccessWarning({ guard }: { readonly guard: AccessGuard }) {
  if (guard.proposed === undefined) return null;
  return (
    <ChangeWarning
      counting={guard.threads === undefined && guard.failure === undefined}
      countingText="Counting the threads this change affects…"
      text={warningText(guard)}
      onConfirm={guard.confirm}
      onCancel={guard.cancel}
    />
  );
}
