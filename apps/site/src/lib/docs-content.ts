/**
 * The docs as the site publishes them, per version: each page's slug, title, description, source
 * file and Markdown, in sidebar order. The plugins page is made of the plugin packages' READMEs.
 */
import { type CollectionEntry, getCollection } from 'astro:content';
import { type DocPlace, rewriteMarkdownLinks } from './doc-links.ts';
import { pluginReadmes, pluginsSlug } from './doc-paths.ts';
import { docDescription, docTitle } from './doc-text.ts';
import { docLabel, docNavItems } from './docs-nav.ts';
import { type DocVersion, docVersions, releasedVersions } from './versions.ts';

/**
 * Every version of the docs the site serves, the latest release first and `next` last.
 *
 * @returns The versions.
 */
export function allVersions(): DocVersion[] {
  return docVersions(releasedVersions());
}

/**
 * The version `docs/` shows: the latest release, or `next` before the first.
 *
 * @returns The version.
 */
export function latestVersion(): DocVersion {
  const [first] = allVersions();
  if (first === undefined) throw new Error('The docs have no version.');
  return first;
}

/**
 * The docs and plugin READMEs of one version, as their collections hold them.
 *
 * @param version - The version.
 * @returns Its docs' entries and its READMEs' entries.
 */
export async function versionEntries(version: DocVersion) {
  const suffix = version.next ? '' : `_${version.id.replaceAll('.', '_')}`;
  // A released version's collections are named after it at build time, so their names are not
  // literal types; they hold entries of the same shape as `docs` and `pluginReadmes`.
  const docs = await getCollection(`docs${suffix}` as 'docs');
  const readmes = await getCollection(`pluginReadmes${suffix}` as 'pluginReadmes');
  return { docs, readmes };
}

/** One source file of a page. */
export interface DocSource {
  /** Its path from the repository root, such as `docs/deployment.md`. */
  readonly repoPath: string;
  /** Its Markdown, as written. */
  readonly markdown: string;
}

/** A published docs page. */
export interface DocPage {
  /** The slug under `docs/`. */
  readonly slug: string;
  /** The title, from the first heading. */
  readonly title: string;
  /** The first paragraph, about 155 characters. */
  readonly description: string;
  /** The files the page renders, in order: one doc, or the plugin READMEs. */
  readonly sources: readonly DocSource[];
  /** Where its links lead: its version's docs and tag. */
  readonly place: DocPlace;
}

/** The plugins page's own title and description. */
const pluginsPage = {
  title: 'Plugins',
  description:
    'Write a connector as a plugin: generate a project with npm create @quanthea/plugin, build it ' +
    'against @quanthea/plugin-kit, and test it with the conformance suite.',
};

/**
 * The page of one doc.
 *
 * @param entry - The doc's collection entry.
 * @param place - Where its links lead.
 * @returns The page.
 */
function pageOfDoc(entry: CollectionEntry<'docs'>, place: DocPlace): DocPage {
  const markdown = entry.body ?? '';
  // The path as the repository holds it, whichever version's folder it was read from.
  const repoPath = /(?:^|\/)(docs\/.+)$/.exec(entry.filePath ?? '')?.[1] ?? '';
  return {
    slug: entry.id,
    title: docTitle(markdown) ?? docLabel(entry.id) ?? entry.id,
    description: docDescription(markdown),
    sources: [{ repoPath, markdown }],
    place,
  };
}

/**
 * The plugins page, from the READMEs in the order of {@link pluginReadmes}.
 *
 * @param entries - The READMEs' collection entries.
 * @param place - Where its links lead.
 * @returns The page.
 */
function pluginsPageOf(entries: CollectionEntry<'pluginReadmes'>[], place: DocPlace): DocPage {
  const sources = pluginReadmes.map((repoPath) => {
    const entry = entries.find((candidate) => repoPath === `packages/${candidate.id}/README.md`);
    return { repoPath, markdown: entry?.body ?? '' };
  });
  return { slug: pluginsSlug, ...pluginsPage, sources, place };
}

/**
 * Every docs page of a version: the sidebar's pages in its order, then any doc it does not list.
 *
 * @param version - The version; the latest release by default.
 * @returns The pages.
 */
export async function docPages(version: DocVersion = latestVersion()): Promise<DocPage[]> {
  const entries = await versionEntries(version);
  const place = { docsPath: version.path, ref: version.ref };
  const docs = entries.docs.map((entry) => pageOfDoc(entry, place));
  const pages = [...docs, pluginsPageOf(entries.readmes, place)];
  const order = (page: DocPage) => {
    const index = docNavItems.findIndex((item) => item.slug === page.slug);
    return index === -1 ? docNavItems.length : index;
  };
  return pages.sort((first, second) => order(first) - order(second));
}

/**
 * A page's Markdown with its links made absolute, for text read off the site.
 *
 * @param page - The page.
 * @param siteBase - The site's absolute base address, such as `https://quanthea.ch/`.
 * @returns The Markdown of every source, links rewritten, one after the other.
 */
export function pageMarkdown(page: DocPage, siteBase: string): string {
  const body = page.sources
    .map((source) =>
      rewriteMarkdownLinks(source.markdown, source.repoPath, siteBase, page.place).trim(),
    )
    .join('\n\n');
  // A page made of several files gets its own title; a doc has its own first heading.
  return page.sources.length > 1 ? `# ${page.title}\n\n${page.description}\n\n${body}` : body;
}
