/**
 * What the site reads out of a doc's Markdown: its title and the first paragraph, for the
 * description. The docs carry no frontmatter.
 */

/**
 * The doc's title, from its first `# ` heading.
 *
 * @param markdown - The doc.
 * @returns The heading's text, or `undefined` when the doc has none.
 */
export function docTitle(markdown: string): string | undefined {
  return /^# (.+)$/m.exec(markdown)?.[1]?.trim();
}

/**
 * Turns Markdown inline syntax into plain text: links keep their text, emphasis and code marks go.
 *
 * @param text - Inline Markdown.
 * @returns Plain text.
 */
export function plainText(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a block of Markdown is a paragraph of prose, not a heading, list, table, quote, code
 * or HTML.
 *
 * @param block - The block, as separated by blank lines.
 * @returns `true` for prose.
 */
function isProse(block: string): boolean {
  return block !== '' && !/^(#|[-*+] |\d+\. |\||>|```|~~~|<|!\[|\[!\[|---)/.test(block);
}

/**
 * Shortens text to a length at a word boundary, with an ellipsis when cut.
 *
 * @param text - The text.
 * @param length - The longest result, ellipsis included.
 * @returns The text, whole or cut.
 */
export function shorten(text: string, length: number): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.;:]$/, '')}…`;
}

/**
 * The doc's description: its first paragraph of prose, as plain text, about 155 characters long.
 *
 * @param markdown - The doc.
 * @returns The description, or an empty string when the doc has no prose.
 */
export function docDescription(markdown: string): string {
  const blocks = markdown.split(/\n\s*\n/).map((block) => block.trim());
  const paragraph = blocks.find(isProse);
  return paragraph === undefined ? '' : shorten(plainText(paragraph), 155);
}

/**
 * The lines of a section of a Markdown document, up to the next heading of its level or higher.
 *
 * @param markdown - The document.
 * @param heading - The section's heading text, such as `Quick start`: a level 1, 2 or 3 heading.
 * @returns The section's lines, without its heading; empty when there is no such section.
 */
function sectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex(
    (line) => /^#{1,3} /.test(line) && line.replace(/^#+ /, '') === heading,
  );
  if (start === -1) return [];
  const level = lines[start]?.indexOf(' ') ?? 2;
  const rest = lines.slice(start + 1);
  let inFence = false;
  const end = rest.findIndex((line) => {
    if (line.startsWith('```')) inFence = !inFence;
    return !inFence && new RegExp(`^#{1,${level}} `).test(line);
  });
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The fenced code blocks of a section of a Markdown document.
 *
 * @param markdown - The document.
 * @param heading - The section's heading text.
 * @returns The blocks' contents, in order, without their fences.
 */
export function codeBlocksUnder(markdown: string, heading: string): string[] {
  const blocks: string[][] = [];
  let block: string[] | undefined;
  for (const line of sectionLines(markdown, heading)) {
    if (!line.startsWith('```')) {
      block?.push(line);
    } else if (block === undefined) {
      block = [];
    } else {
      blocks.push(block);
      block = undefined;
    }
  }
  return blocks.map((lines) => lines.join('\n'));
}
