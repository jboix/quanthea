/**
 * A remark plugin that rewrites the links of the repository's Markdown files as the site renders
 * them: `foo.md#bar` becomes the page `<base>docs/foo/#bar`, and a link outside the published docs
 * becomes its GitHub address. Images stay as written, for Astro to process.
 */
import { relative, sep } from 'node:path';
import { rewriteDocLink } from './doc-links.ts';

/** The part of a Markdown syntax tree node the plugins read. */
export interface MarkdownNode {
  /** The node type, such as `link` or `heading`. */
  type: string;
  /** The address of a link or a definition. */
  url?: string;
  /** The level of a heading. */
  depth?: number;
  /** The text of a text node. */
  value?: string;
  /** The child nodes. */
  children?: MarkdownNode[];
}

/** The part of a virtual file the plugins read. */
export interface MarkdownFile {
  /** The file's absolute path. */
  path?: string;
}

/** Options of {@link remarkDocLinks}. */
export interface DocLinkOptions {
  /** The site's base path, such as `/` or `/quanthea`. */
  readonly base: string;
  /** The repository root's absolute path. */
  readonly repoRoot: string;
}

/**
 * Calls a function on a node and every node below it.
 *
 * @param node - The top node.
 * @param visit - What to do with each node.
 */
export function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/**
 * The repository path of a file, or `undefined` when it is outside the repository.
 *
 * @param path - The file's absolute path.
 * @param repoRoot - The repository root's absolute path.
 * @returns The path from the root, with `/` separators.
 */
function repoPathOf(path: string | undefined, repoRoot: string): string | undefined {
  if (path === undefined) return undefined;
  const fromRoot = relative(repoRoot, path);
  return fromRoot.startsWith('..') ? undefined : fromRoot.split(sep).join('/');
}

/**
 * The plugin.
 *
 * @param options - The site's base and the repository root.
 * @returns The transformer, which rewrites links and definitions in place.
 */
export function remarkDocLinks(options: DocLinkOptions) {
  return (tree: MarkdownNode, file: MarkdownFile): void => {
    const from = repoPathOf(file.path, options.repoRoot);
    if (from === undefined) return;
    walk(tree, (node) => {
      if ((node.type === 'link' || node.type === 'definition') && node.url !== undefined) {
        node.url = rewriteDocLink(node.url, from, options.base);
      }
    });
  };
}
