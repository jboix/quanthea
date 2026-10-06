/**
 * Checks every internal link of the built site: each `href` and `src` of the HTML pages, and each
 * Markdown link of the text files (`llms.txt`), must name a file of `dist/`, and each `#fragment`
 * an `id` on its page. Run after the build; it exits with an error when a link is broken.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The built site. */
const dist = new URL('../dist/', import.meta.url).pathname;

/** The site's origin and base, as the build used them. */
const site = (process.env.SITE_URL || 'https://quanthea.ch').replace(/\/$/, '');
const base = `/${(process.env.SITE_BASE || '/').replace(/^\/|\/$/g, '')}/`.replace('//', '/');

/** A link found in a file. */
interface FoundLink {
  /** The file it is in, from `dist/`. */
  readonly file: string;
  /** The link as written. */
  readonly url: string;
}

/**
 * Lists the files of a directory, recursively.
 *
 * @param directory - The directory.
 * @returns The files' paths.
 */
function filesOf(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesOf(path) : [path];
  });
}

/**
 * The address path a file is served at.
 *
 * @param file - The file's path from `dist/`.
 * @returns Its path from the host's root, such as `/quanthea/docs/deployment/`.
 */
function servedPath(file: string): string {
  return `${base}${file.replace(/(^|\/)index\.html$/, '$1')}`;
}

/**
 * The links of a file: attributes of a page, Markdown links of a text file.
 *
 * @param file - The file's path from `dist/`.
 * @param text - Its content.
 * @returns The links.
 */
function linksOf(file: string, text: string): FoundLink[] {
  const pattern = file.endsWith('.html')
    ? /\s(?:href|src)="([^"]+)"/g
    : /\]\((https?:\/\/[^)\s]+)\)|^(?:Sitemap): (\S+)$/gm;
  return [...text.matchAll(pattern)].map((match) => ({ file, url: match[1] ?? match[2] ?? '' }));
}

/**
 * The site path a link points at, or `undefined` for a link that leaves the site.
 *
 * @param link - The link.
 * @returns The path from the host's root, with its fragment.
 */
function sitePath(link: FoundLink): string | undefined {
  const url = link.url.replaceAll('&amp;', '&');
  if (url.startsWith(`${site}/`)) return url.slice(site.length);
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return undefined;
  return (
    new URL(url, `https://host${servedPath(link.file)}`).pathname + new URL(url, 'https://h').hash
  );
}

/** The ids of each page, read once. */
const idsByFile = new Map<string, Set<string>>();

/**
 * The ids of a page.
 *
 * @param file - The page's absolute path.
 * @returns Its ids.
 */
function idsOf(file: string): Set<string> {
  const cached = idsByFile.get(file);
  if (cached) return cached;
  const ids = new Set(
    [...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? ''),
  );
  idsByFile.set(file, ids);
  return ids;
}

/**
 * Why a link is broken.
 *
 * @param path - The path it points at, with its fragment.
 * @returns The problem, or `undefined` when the link works.
 */
function problemOf(path: string): string | undefined {
  const [pathname = '', fragment] = path.split('#');
  if (!pathname.startsWith(base)) return `outside the base ${base}`;
  const inside = decodeURIComponent(pathname.slice(base.length));
  const file = join(dist, inside.endsWith('/') || inside === '' ? `${inside}index.html` : inside);
  if (!existsSync(file))
    return existsSync(join(dist, inside, 'index.html')) ? 'no trailing slash' : 'no such file';
  if (fragment && file.endsWith('.html') && !idsOf(file).has(decodeURIComponent(fragment))) {
    return `no id "${fragment}"`;
  }
  return undefined;
}

const files = filesOf(dist)
  .map((path) => relative(dist, path))
  .filter((file) => /\.(html|txt)$/.test(file) && !file.startsWith('pagefind/'));
const broken = files.flatMap((file) =>
  linksOf(file, readFileSync(join(dist, file), 'utf8')).flatMap((link) => {
    const path = sitePath(link);
    const problem = path === undefined ? undefined : problemOf(path);
    return problem === undefined ? [] : [`${link.file}: ${link.url} (${problem})`];
  }),
);
process.stdout.write(`Checked the links of ${files.length} files under ${site}${base}.\n`);
if (broken.length > 0) {
  process.stderr.write(`${broken.length} broken links:\n${broken.join('\n')}\n`);
  process.exit(1);
}
