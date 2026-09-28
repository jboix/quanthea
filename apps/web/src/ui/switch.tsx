import { type ReactNode, useId } from 'react';
import styles from './switch.module.css';

/** Props of {@link Switch}. */
interface SwitchProps {
  /** What the switch turns on. */
  readonly label: ReactNode;
  /** One line explaining the effect. */
  readonly description?: ReactNode;
  /** Whether it is on. */
  readonly checked: boolean;
  /** Called with the new state when the user flips it. */
  readonly onChange: (checked: boolean) => void;
  /** Shows the switch without letting the user flip it. */
  readonly disabled?: boolean;
}

/**
 * A settings row with a label, a description and an on/off switch on the right.
 *
 * @param props - Label, description, state and change callback.
 * @returns The row.
 */
export function Switch({ label, description, checked, onChange, disabled = false }: SwitchProps) {
  const labelId = useId();
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {description !== undefined && <span className={styles.description}>{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        className={styles.switch}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.thumb} />
      </button>
    </div>
  );
}
