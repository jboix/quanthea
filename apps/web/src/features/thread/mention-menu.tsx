import styles from './composer.module.css';
import type { MentionMenuState } from './use-mention.ts';

/** The id of the `@` menu, which the text box controls. */
export const mentionMenuId = 'mention-menu';

/**
 * The id of a panel listed in the `@` menu.
 *
 * @param index - The panel's place in the menu.
 * @returns The option's id.
 */
export function mentionOptionId(index: number): string {
  return `${mentionMenuId}-${index}`;
}

/**
 * The menu of panels matching the `@` being typed: the arrows move through it, Enter or Tab pick
 * the chosen one, and the cross or Escape shut it until another `@`.
 *
 * @param props - The menu.
 * @param props.menu - The menu's state.
 * @returns The menu.
 */
export function MentionMenu({ menu }: { readonly menu: MentionMenuState }) {
  return (
    <div className={styles.menu}>
      <div className={styles.menuHead}>
        <span>Mention a panel</span>
        <button
          type="button"
          className={styles.menuClose}
          aria-label="Close the panel list"
          onMouseDown={(event) => event.preventDefault()}
          onClick={menu.dismiss}
        >
          ×
        </button>
      </div>
      <div id={mentionMenuId} role="listbox" aria-label="Panels" className={styles.menuList}>
        {menu.matches.map((panel, index) => (
          <div
            key={panel.id}
            id={mentionOptionId(index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === menu.active}
            className={styles.menuItem}
            onMouseEnter={() => menu.choose(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              menu.pick(panel);
            }}
          >
            {panel.title}
          </div>
        ))}
      </div>
      <p className={styles.menuHint}>↑ ↓ to move · Enter to pick · Esc to close</p>
    </div>
  );
}
