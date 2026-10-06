/**
 * Mounts Pagefind's search interface. Its script, styles and index are files the build writes
 * next to the pages, so the search runs in the browser with no server.
 */

/** The part of Pagefind's interface this module uses. */
interface PagefindWindow {
  /** The interface's constructor, which the script sets on the window. */
  PagefindUI?: new (
    options: Record<string, unknown>,
  ) => unknown;
}

/**
 * Loads a script once.
 *
 * @param source - The script's address.
 * @returns A promise that settles when the script ran or failed to load.
 */
function loadScript(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error(`${source} did not load.`)));
    document.head.append(script);
  });
}

/**
 * Mounts the search in an element.
 *
 * @param element - The element, whose `data-bundle` names the index's folder.
 */
export async function mountSearch(element: HTMLElement): Promise<void> {
  const bundlePath = element.dataset.bundle ?? '/pagefind/';
  const styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = `${bundlePath}pagefind-ui.css`;
  document.head.append(styles);
  try {
    await loadScript(`${bundlePath}pagefind-ui.js`);
    const PagefindUI = (window as PagefindWindow).PagefindUI;
    if (PagefindUI === undefined) return;
    new PagefindUI({ element, bundlePath, showSubResults: true, resetStyles: false });
  } catch {
    // The dev server has no index: the build writes it.
    element.textContent = 'Search works on the built site (bun run site:build).';
  }
}

/**
 * Opens or closes the search over the page, on a narrow screen: it marks the host, locks the
 * page's scroll, and moves focus to the input, or back to the magnifier.
 *
 * @param host - The element around the toggle and the search.
 * @param open - Whether to open it.
 */
function setOpen(host: HTMLElement, open: boolean): void {
  const toggle = host.querySelector<HTMLButtonElement>('[data-search-open]');
  const panel = host.querySelector<HTMLElement>('.search-panel');
  host.dataset.open = String(open);
  toggle?.setAttribute('aria-expanded', String(open));
  panel?.setAttribute('role', open ? 'dialog' : 'none');
  panel?.setAttribute('aria-label', 'Search the docs');
  document.documentElement.style.overflow = open ? 'hidden' : '';
  if (open) host.querySelector<HTMLInputElement>('.pagefind-ui__search-input')?.focus();
  else toggle?.focus();
}

/**
 * Wires the magnifier and Cancel of the search, and Escape to close it.
 *
 * @param host - The element around the toggle and the search.
 */
export function wireSearchToggle(host: HTMLElement): void {
  host.querySelector('[data-search-open]')?.addEventListener('click', () => setOpen(host, true));
  host.querySelector('[data-search-close]')?.addEventListener('click', () => setOpen(host, false));
  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && host.dataset.open === 'true') setOpen(host, false);
  });
}
