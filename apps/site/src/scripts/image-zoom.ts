/**
 * The image dialog of the docs: a press on a doc's image opens it larger, and a press on the
 * larger image switches it between fitting the window and its full size.
 */

/**
 * Shows an image in the dialog, fitted to the window.
 *
 * @param dialog - The image dialog.
 * @param image - The doc's image pressed.
 */
function open(dialog: HTMLDialogElement, image: HTMLImageElement): void {
  const shown = dialog.querySelector<HTMLImageElement>('[data-zoom-image]');
  const stage = dialog.querySelector<HTMLElement>('[data-zoom-stage]');
  if (!shown || !stage) return;
  shown.src = image.currentSrc || image.src;
  shown.alt = image.alt;
  delete stage.dataset.full;
  dialog.showModal();
}

/**
 * Switches the shown image between fitting the window and its full size.
 *
 * @param stage - The element that holds the image and scrolls at full size.
 */
function toggleFullSize(stage: HTMLElement): void {
  if ('full' in stage.dataset) delete stage.dataset.full;
  else stage.dataset.full = '';
}

/**
 * Opens each image in the dialog on a press, and wires the dialog's own presses.
 *
 * @param dialog - The image dialog.
 * @param images - The doc's images.
 */
export function attachImageZoom(
  dialog: HTMLDialogElement,
  images: Iterable<HTMLImageElement>,
): void {
  for (const image of images) image.addEventListener('click', () => open(dialog, image));
  dialog.querySelector('[data-zoom-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const stage = dialog.querySelector<HTMLElement>('[data-zoom-stage]');
    // A press on the image zooms; a press around it closes the dialog.
    if (target.matches('[data-zoom-image]') && stage) toggleFullSize(stage);
    else if (target === dialog || target === stage) dialog.close();
  });
}
