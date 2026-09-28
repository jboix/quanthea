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
 * The class names of a button style, for a link that looks like a button.
 *
 * @param variant - The style.
 * @param size - The height.
 * @returns The class names.
 */
export function buttonClassName(
  variant: ButtonVariant = 'secondary',
  size: ButtonProps['size'] = 'default',
): string {
  return [styles.button, styles[variant], size === 'default' ? '' : styles[size]]
    .filter(Boolean)
    .join(' ');
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
  const classes = [buttonClassName(variant, size), className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}
