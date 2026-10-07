/**
 * A remark plugin that rewrites the links of the repository's Markdown files as the site renders
 * them: `foo.md#bar` becomes the page `foo` of the same version of the docs, and a link outside the
 * published docs becomes its GitHub address at that version's tag. A file under
 * `apps/site/.versions/<id>/` belongs to that released version; any other to `next`. Images stay as
 * written, for Astro to process.
 */
import { relative, sep } from 'node:path';
import { type DocPlace, rewriteDocLink } from './doc-links.ts';
import { type DocVersion, docVersions, releasedVersions } from './versions.ts';

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

/** A released version's file, from the repository root: its version and its own path. */
const versionedFile = /^apps\/site\/\.versions\/(v\d+\.\d+)\/(.+)$/;

/**
 * The version a file belongs to, and its path as that version's repository held it.
 *
 * @param fromRoot - The file's path from the repository root.
 * @param versions - The versions of the docs.
 * @returns The file's own path, and where its links lead.
 */
export function placeOf(
  fromRoot: string,
  versions: readonly DocVersion[],
): { readonly from: string; readonly place: DocPlace } {
  const match = versionedFile.exec(fromRoot);
  const version = match
    ? versions.find((each) => each.id === match[1])
    : versions.find((each) => each.next);
  const place = { docsPath: version?.path ?? 'docs/', ref: version?.ref ?? 'main' };
  return { from: match?.[2] ?? fromRoot, place };
}

/**
 * The plugin.
 *
 * @param options - The site's base and the repository root.
 * @returns The transformer, which rewrites links and definitions in place.
 */
export function remarkDocLinks(options: DocLinkOptions) {
  const versions = docVersions(releasedVersions());
  return (tree: MarkdownNode, file: MarkdownFile): void => {
    const fromRoot = repoPathOf(file.path, options.repoRoot);
    if (fromRoot === undefined) return;
    const { from, place } = placeOf(fromRoot, versions);
    walk(tree, (node) => {
      if ((node.type === 'link' || node.type === 'definition') && node.url !== undefined) {
        node.url = rewriteDocLink(node.url, from, options.base, place);
      }
    });
  };
}
