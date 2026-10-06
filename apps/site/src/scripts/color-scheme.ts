/**
 * The colour scheme, the same way the web app keeps it: `light`, `dark` or `system`, stored per
 * browser under `quanthea.color-scheme` and applied as `data-theme` on the document element. The
 * inline script in the page head applies it before the first paint; this module keeps it current.
 */

/** What the person picks. */
type ColorScheme = 'light' | 'dark' | 'system';

/** Where the choice is kept. */
const storageKey = 'quanthea.color-scheme';

/** The event the window receives when the scheme the page shows changes. */
export const schemeChangeEvent = 'quanthea:color-scheme';

/** The system's preference. */
const darkQuery = '(prefers-color-scheme: dark)';

/** The order the toggle cycles through. */
const cycle: readonly ColorScheme[] = ['system', 'light', 'dark'];

/**
 * The stored choice. Storage can be blocked, so a failed read means `system`.
 *
 * @returns The choice.
 */
function storedScheme(): ColorScheme {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Keeps a choice. A blocked storage keeps it for this page only.
 *
 * @param scheme - The choice.
 */
function storeScheme(scheme: ColorScheme): void {
  try {
    localStorage.setItem(storageKey, scheme);
  } catch {
    // Private windows and blocked site data keep the choice for this page only.
  }
}

/**
 * Applies a choice to the document and tells the page.
 *
 * @param scheme - The choice.
 */
function applyScheme(scheme: ColorScheme): void {
  const dark = scheme === 'dark' || (scheme === 'system' && matchMedia(darkQuery).matches);
  const root = document.documentElement;
  root.dataset.scheme = scheme;
  root.dataset.theme = dark ? 'dark' : 'light';
  window.dispatchEvent(new CustomEvent(schemeChangeEvent));
}

/**
 * Names a choice for the toggle's label.
 *
 * @param scheme - The choice.
 * @returns The label.
 */
function schemeLabel(scheme: ColorScheme): string {
  if (scheme === 'system') return 'Colour scheme: system. Switch to light';
  return scheme === 'light'
    ? 'Colour scheme: light. Switch to dark'
    : 'Colour scheme: dark. Switch to system';
}

/**
 * Wires the toggle buttons: each press moves to the next choice, which is kept and applied.
 *
 * @param buttons - The toggle buttons.
 */
export function wireSchemeToggles(buttons: Iterable<HTMLButtonElement>): void {
  const all = [...buttons];
  let current = storedScheme();
  const label = () => {
    for (const button of all) button.setAttribute('aria-label', schemeLabel(current));
  };
  for (const button of all) {
    button.addEventListener('click', () => {
      current = cycle[(cycle.indexOf(current) + 1) % cycle.length] ?? 'system';
      storeScheme(current);
      applyScheme(current);
      label();
    });
  }
  matchMedia(darkQuery).addEventListener('change', () => {
    if (current === 'system') applyScheme('system');
  });
  label();
}
