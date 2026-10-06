/**
 * A remark plugin for screenshots taken in both colour schemes. The docs follow GitHub's
 * convention: an image whose address ends in `#gh-light-mode-only` shows in the light scheme, and
 * one ending in `#gh-dark-mode-only` in the dark one. The site drops the fragment, so Astro finds
 * the file, and gives the image the class that hides it in the other scheme.
 */
import { type MarkdownNode, walk } from './remark-doc-links.ts';

/** The site's class for each of GitHub's fragments. */
const schemeClasses: Readonly<Record<string, string>> = {
  '#gh-light-mode-only': 'on-light',
  '#gh-dark-mode-only': 'on-dark',
};

/** An image node, with the HTML properties remark passes on. */
export interface ImageNode extends MarkdownNode {
  /** What remark passes on to the HTML element. */
  data?: { hProperties?: Record<string, unknown> };
}

/**
 * Splits an image address into the file and the scheme it shows in.
 *
 * @param url - The address, such as `screenshots/library-dark.webp#gh-dark-mode-only`.
 * @returns The address without the fragment and the class, or `undefined` for any other image.
 */
export function schemeImage(url: string): { url: string; className: string } | undefined {
  const hash = url.indexOf('#');
  if (hash === -1) return undefined;
  const className = schemeClasses[url.slice(hash)];
  return className === undefined ? undefined : { url: url.slice(0, hash), className };
}

/**
 * The plugin.
 *
 * @returns The transformer, which rewrites the images in place.
 */
export function remarkSchemeImages() {
  return (tree: MarkdownNode): void => {
    walk(tree, (node: ImageNode) => {
      if (node.type !== 'image' || node.url === undefined) return;
      const scheme = schemeImage(node.url);
      if (scheme === undefined) return;
      node.url = scheme.url;
      node.data = { ...node.data, hProperties: { className: [scheme.className] } };
    });
  };
}
