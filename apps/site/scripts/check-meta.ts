/**
 * Checks the head of every built page: a title no other page has, a description, a canonical
 * address under the site's address and base, the OpenGraph tags with absolute addresses, and
 * JSON-LD that parses. Run after the build; it exits with an error when a page falls short.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The built site. */
const dist = new URL('../dist/', import.meta.url).pathname;

/** The address every absolute link of the site starts with. */
const siteBase = `${(process.env.SITE_URL || 'https://quanthea.ch').replace(/\/$/, '')}${`/${(process.env.SITE_BASE || '/').replace(/^\/|\/$/g, '')}/`.replace('//', '/')}`;

/** The OpenGraph properties every page has. */
const openGraph = ['og:title', 'og:description', 'og:url', 'og:image', 'og:type'];

/**
 * Lists the HTML pages under a directory, recursively, leaving out Pagefind's files.
 *
 * @param directory - The directory.
 * @returns The pages' paths.
 */
function pagesOf(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'pagefind' ? [] : pagesOf(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

/**
 * The content of a meta tag.
 *
 * @param html - The page.
 * @param attribute - `name` or `property`.
 * @param key - The tag's name or property.
 * @returns The content, or `undefined`.
 */
function meta(html: string, attribute: string, key: string): string | undefined {
  return new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`).exec(html)?.[1];
}

/**
 * What is wrong with a page's OpenGraph tags.
 *
 * @param html - The page.
 * @returns The problems.
 */
function openGraphProblems(html: string): string[] {
  return openGraph.flatMap((property) => {
    const value = meta(html, 'property', property);
    if (!value) return [`no ${property}`];
    const absolute = !/url|image/.test(property) || value.startsWith(siteBase);
    return absolute ? [] : [`${property} outside ${siteBase}`];
  });
}

/**
 * Whether each JSON-LD block of a page parses.
 *
 * @param html - The page.
 * @returns The problems.
 */
function jsonLdProblems(html: string): string[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].flatMap(
    (match) => {
      try {
        JSON.parse(match[1] ?? '');
        return [];
      } catch {
        return ['JSON-LD that does not parse'];
      }
    },
  );
}

/**
 * What is wrong with a page's head.
 *
 * @param html - The page.
 * @returns The problems; empty when the head is complete.
 */
function problemsOf(html: string): string[] {
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? '';
  return [
    ...(meta(html, 'name', 'description') ? [] : ['no description']),
    ...(canonical.startsWith(siteBase) ? [] : [`canonical "${canonical}"`]),
    ...openGraphProblems(html),
    ...jsonLdProblems(html),
  ];
}

const titles = new Map<string, string>();
const report = pagesOf(dist).flatMap((path) => {
  const page = relative(dist, path);
  const html = readFileSync(path, 'utf8');
  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? '';
  const problems = problemsOf(html);
  if (title === '') problems.push('no title');
  if (titles.has(title)) problems.push(`the title of ${titles.get(title)}`);
  titles.set(title, page);
  return problems.map((problem) => `${page}: ${problem}`);
});
process.stdout.write(`Checked the head of ${titles.size} pages.\n`);
if (report.length > 0) {
  process.stderr.write(`${report.join('\n')}\n`);
  process.exit(1);
}
