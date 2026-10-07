/**
 * Builds one search index per version of the docs, after the build: the latest release's pages
 * into `pagefind/`, an older release's into `docs/vX.Y/pagefind/`, and `next`'s into
 * `docs/next/pagefind/`. Each docs page searches its own version's index only, so a search never
 * crosses versions.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { close, createIndex } from 'pagefind';
import { type DocVersion, docVersions, releasedVersions } from '../src/lib/versions.ts';

/** The built site. */
const dist = new URL('../dist/', import.meta.url).pathname;

/**
 * The HTML pages under a folder, recursively, leaving out the folders named.
 *
 * @param directory - The folder.
 * @param skipped - Names of the folders to leave out, such as other versions' folders.
 * @returns The pages' paths.
 */
function pagesOf(directory: string, skipped: ReadonlySet<string> = new Set()): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return skipped.has(entry.name) ? [] : pagesOf(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

/**
 * Indexes one version's pages into its own bundle.
 *
 * @param version - The version.
 * @param others - The other versions, whose folders the latest's pages sit beside.
 * @returns How many pages it indexed.
 */
async function indexVersion(version: DocVersion, others: readonly DocVersion[]): Promise<number> {
  const folder = join(dist, version.path);
  // The latest release's pages sit at `docs/`, beside the other versions' folders.
  const skipped = new Set(version.latest ? others.map((other) => other.id) : []);
  const pages = pagesOf(folder, skipped);
  const { index } = await createIndex({});
  if (!index) throw new Error(`No search index for ${version.id}.`);
  // Pagefind's interface prefixes each result with its bundle's folder, as the CLI's root bundle
  // had it: the site's base for the latest release's, the version's folder for the others'.
  const bundleRoot = join(dist, version.latest ? '' : version.path);
  for (const page of pages) {
    const url = `/${relative(bundleRoot, page).replace(/(^|\/)index\.html$/, '$1')}`;
    await index.addHTMLFile({ url, content: readFileSync(page, 'utf8') });
  }
  const outputPath = join(bundleRoot, 'pagefind');
  await index.writeFiles({ outputPath });
  return pages.length;
}

const versions = docVersions(releasedVersions());
for (const version of versions) {
  const others = versions.filter((other) => other !== version);
  const count = await indexVersion(version, others);
  process.stdout.write(`Indexed ${count} pages of ${version.id}.\n`);
}
await close();
