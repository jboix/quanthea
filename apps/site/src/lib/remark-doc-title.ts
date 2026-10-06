/**
 * A remark plugin that removes a document's first `# ` heading. The docs carry no frontmatter: the
 * site reads the title from that heading (`docTitle`) and the layout renders it. Files shown as a
 * section of a page, such as the plugin READMEs, also have their headings moved down a level, and
 * their ids prefixed with the file's folder, so two sections on one page never share an id.
 */
import type { MarkdownFile, MarkdownNode } from './remark-doc-links.ts';
import { walk } from './remark-doc-links.ts';

/** Options of {@link remarkDocTitle}. */
export interface DocTitleOptions {
  /** Path fragments of the files shown as sections, such as `/packages/`. */
  readonly demote?: readonly string[];
}

/** A heading node with the properties its HTML element gets. */
interface HeadingNode extends MarkdownNode {
  /** The HTML properties remark passes on. */
  data?: { hProperties?: Record<string, string> };
}

/**
 * The text of a node and its children.
 *
 * @param node - The node.
 * @returns The text.
 */
function textOf(node: MarkdownNode): string {
  return node.value ?? (node.children ?? []).map(textOf).join('');
}

/**
 * A heading's id, the way GitHub writes it, with a prefix.
 *
 * @param prefix - The prefix, such as `plugin-kit`.
 * @param text - The heading's text.
 * @returns The id, such as `plugin-kit-licence`.
 */
export function prefixedId(prefix: string, text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
  return `${prefix}-${slug}`;
}

/**
 * Moves a section file's headings down a level and prefixes their ids.
 *
 * @param tree - The file's tree.
 * @param prefix - The id prefix.
 */
function demoteHeadings(tree: MarkdownNode, prefix: string): void {
  walk(tree, (node: HeadingNode) => {
    if (node.type !== 'heading' || node.depth === undefined) return;
    node.depth = Math.min(node.depth + 1, 6);
    node.data = { ...node.data, hProperties: { id: prefixedId(prefix, textOf(node)) } };
  });
}

/**
 * The plugin.
 *
 * @param options - Which files are shown as sections.
 * @returns The transformer, which drops the first level-one heading at the top level.
 */
export function remarkDocTitle(options: DocTitleOptions = {}) {
  return (tree: MarkdownNode, file: MarkdownFile): void => {
    const children = tree.children ?? [];
    const index = children.findIndex((node) => node.type === 'heading' && node.depth === 1);
    if (index !== -1) children.splice(index, 1);
    const path = file.path ?? '';
    if (!(options.demote ?? []).some((fragment) => path.includes(fragment))) return;
    demoteHeadings(tree, path.split('/').at(-2) ?? 'section');
  };
}
