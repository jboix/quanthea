/**
 * Rewrites the links of a repository Markdown file for the site: a link to a published doc goes to
 * its page, a link anywhere else in the repository goes to GitHub.
 */
import { directoryOf, publishedSlug, resolveRepoPath } from './doc-paths.ts';
import { githubRawUrl, githubUrl } from './project.ts';
import { joinBase } from './url.ts';

/**
 * Whether a link leaves the repository's files: a scheme, a protocol-relative or rooted path, or
 * an anchor on the same page.
 *
 * @param url - The link as written.
 * @returns `true` when the link stays as written.
 */
function keepsAsWritten(url: string): boolean {
  return url === '' || /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url);
}

/**
 * Splits a link into its path and its `#fragment`.
 *
 * @param url - The link.
 * @returns The path and the fragment, which keeps its `#` or is empty.
 */
function splitFragment(url: string): { path: string; fragment: string } {
  const index = url.indexOf('#');
  if (index === -1) return { path: url, fragment: '' };
  return { path: url.slice(0, index), fragment: url.slice(index) };
}

/**
 * The site or GitHub address of a link in a repository Markdown file.
 *
 * @param url - The link as written, such as `deployment.md#quick-start` or `../deploy/`.
 * @param fromRepoPath - The path of the file it is written in, from the repository root.
 * @param siteBase - The site's base: a path such as `/quanthea/`, or an absolute address.
 * @returns The rewritten link: `<base>docs/<slug>/#fragment` for a published doc, a GitHub
 * address for any other file or directory, and the link unchanged when it is not relative.
 */
export function rewriteDocLink(url: string, fromRepoPath: string, siteBase: string): string {
  if (keepsAsWritten(url)) return url;
  const { path, fragment } = splitFragment(url);
  const repoPath = resolveRepoPath(directoryOf(fromRepoPath), path);
  if (repoPath === undefined) return url;
  const slug = publishedSlug(repoPath);
  if (slug !== undefined) return `${joinBase(siteBase, `docs/${slug}/`)}${fragment}`;
  return `${githubUrl(repoPath)}${fragment}`;
}

/**
 * The raw GitHub address of an image in a repository Markdown file, for text read off the site.
 *
 * @param url - The image source as written, such as `brand/quanthea-logo-preview.png`.
 * @param fromRepoPath - The path of the file it is written in, from the repository root.
 * @returns The raw address, or the source unchanged when it is not relative.
 */
export function rewriteDocImage(url: string, fromRepoPath: string): string {
  if (keepsAsWritten(url)) return url;
  const repoPath = resolveRepoPath(directoryOf(fromRepoPath), url);
  return repoPath === undefined ? url : githubRawUrl(repoPath);
}

/** An inline link or image: `[text](url "title")` or `![alt](url)`. */
const inlineLink = /(!?)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

/** A reference definition: `[label]: url`. */
const definition = /^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/;

/**
 * Rewrites the links and images of one line of Markdown outside code.
 *
 * @param line - The line.
 * @param fromRepoPath - The path of the file, from the repository root.
 * @param siteBase - The site's base.
 * @returns The line with its links rewritten.
 */
function rewriteLine(line: string, fromRepoPath: string, siteBase: string): string {
  const inline = line.replace(inlineLink, (_match, bang: string, text, url: string, title) => {
    const target =
      bang === '!'
        ? rewriteDocImage(url, fromRepoPath)
        : rewriteDocLink(url, fromRepoPath, siteBase);
    return `${bang}[${text}](${target}${title})`;
  });
  return inline.replace(
    definition,
    (_match, label: string, url: string) =>
      `${label}${rewriteDocLink(url, fromRepoPath, siteBase)}`,
  );
}

/**
 * Rewrites every link and image of a Markdown document, leaving fenced code alone.
 *
 * @param markdown - The document.
 * @param fromRepoPath - Its path from the repository root.
 * @param siteBase - The site's base, absolute for text read off the site.
 * @returns The document with its links rewritten.
 */
export function rewriteMarkdownLinks(
  markdown: string,
  fromRepoPath: string,
  siteBase: string,
): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      return inFence ? line : rewriteLine(line, fromRepoPath, siteBase);
    })
    .join('\n');
}
