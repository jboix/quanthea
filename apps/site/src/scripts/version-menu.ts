/**
 * Closes the docs' version menus as a menu should: a press outside an open one closes it, and
 * Escape closes it and gives focus back to its button. The menus are `<details>` elements, which
 * open and close on their own button without script.
 */

/**
 * Wires every version menu of the page.
 */
export function wireVersionMenus(): void {
  const menus = [...document.querySelectorAll<HTMLDetailsElement>('details[data-versions]')];
  if (menus.length === 0) return;
  document.addEventListener('click', (event) => {
    for (const menu of menus) {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const menu of menus.filter((each) => each.open)) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
}
