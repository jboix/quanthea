/** Writing text into the HTML report. */

/**
 * Text safe in HTML.
 *
 * @param text - The text.
 * @returns The escaped text.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
