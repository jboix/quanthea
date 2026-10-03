import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './menu-item.module.css';

/** What a menu item says: its name, and a line under it on what it does. */
interface MenuItemTextProps {
  /** The name of the action. */
  readonly label: ReactNode;
  /** What it does, in a few words; left out when the name says it all. */
  readonly hint?: string | undefined;
}

/** Props of {@link MenuItem}. */
interface MenuItemProps
  extends MenuItemTextProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {}

/** The class of a menu item, for a link that reads as one. */
export const menuItemClassName = styles.item;

/**
 * The name of a menu item, with its hint under it.
 *
 * @param props - The name and the hint.
 * @returns The text.
 */
export function MenuItemText({ label, hint }: MenuItemTextProps) {
  return (
    <>
      <span className={styles.label}>{label}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </>
  );
}

/**
 * One action in a menu: a full-width button with its name and, under it, what it does.
 *
 * @param props - The name, the hint and any native button attribute.
 * @returns The button.
 */
export function MenuItem({ label, hint, type = 'button', ...rest }: MenuItemProps) {
  return (
    <button type={type} className={styles.item} {...rest}>
      <MenuItemText label={label} hint={hint} />
    </button>
  );
}
