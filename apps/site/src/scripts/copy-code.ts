/**
 * Copy buttons for code: one on each code block of a doc, and the copy-to-clipboard commands of
 * the landing and pricing pages.
 */

/** How long a button says "Copied" before it reads "Copy" again, in milliseconds. */
const confirmationTime = 1600;

/**
 * Copies text and says so on the button.
 *
 * @param button - The button pressed.
 * @param text - The text to copy.
 */
export async function copyWithConfirmation(button: HTMLButtonElement, text: string): Promise<void> {
  const label = button.dataset.label ?? button.textContent ?? 'Copy';
  button.dataset.label = label;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Select and copy';
  }
  setTimeout(() => {
    button.textContent = label;
  }, confirmationTime);
}

/**
 * Adds a copy button to each code block.
 *
 * @param blocks - The `pre` elements.
 */
export function addCopyButtons(blocks: Iterable<HTMLPreElement>): void {
  for (const block of blocks) {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    block.replaceWith(wrapper);
    wrapper.append(block);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-button';
    button.textContent = 'Copy';
    button.addEventListener('click', () => {
      copyWithConfirmation(button, block.querySelector('code')?.innerText ?? block.innerText);
    });
    wrapper.append(button);
  }
}
