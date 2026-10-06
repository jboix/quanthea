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
