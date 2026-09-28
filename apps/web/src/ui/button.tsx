import type { ButtonHTMLAttributes } from 'react';
import styles from './button.module.css';

/** The button styles of the visual language. */
type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'danger';

/** Props of {@link Button}. */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` (blue) for the main action, `dark` for Pin-like actions, `danger` for deletion. */
  readonly variant?: ButtonVariant;
  /** The height: `small` in cards, `large` in page headers. */
  readonly size?: 'small' | 'default' | 'large';
}

/**
 * A button in one of the visual language's styles. It defaults to `type="button"` so it never submits a
 * form by accident.
 *
 * @param props - The variant, the size and any native button attribute.
 * @returns The button element.
 */
export function Button({
  variant = 'secondary',
  size = 'default',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    size === 'default' ? '' : styles[size],
    className,
  ];
  return <button type={type} className={classes.filter(Boolean).join(' ')} {...rest} />;
}
