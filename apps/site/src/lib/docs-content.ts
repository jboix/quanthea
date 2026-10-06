/**
 * The docs as the site publishes them: each page's slug, title, description, source file and
 * Markdown, in sidebar order. The plugins page is made of the plugin packages' READMEs.
 */
import { type CollectionEntry, getCollection } from 'astro:content';
import { rewriteMarkdownLinks } from './doc-links.ts';
import { pluginReadmes, pluginsSlug } from './doc-paths.ts';
import { docDescription, docTitle } from './doc-text.ts';
import { docLabel, docNavItems } from './docs-nav.ts';

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
 * @returns The page.
 */
function pageOfDoc(entry: CollectionEntry<'docs'>): DocPage {
  const markdown = entry.body ?? '';
  const fileName = (entry.filePath ?? '').split('/').pop() ?? '';
  return {
    slug: entry.id,
    title: docTitle(markdown) ?? docLabel(entry.id) ?? entry.id,
    description: docDescription(markdown),
    sources: [{ repoPath: `docs/${fileName}`, markdown }],
  };
}

/**
 * The plugins page, from the READMEs in the order of {@link pluginReadmes}.
 *
 * @param entries - The READMEs' collection entries.
 * @returns The page.
 */
function pluginsPageOf(entries: CollectionEntry<'pluginReadmes'>[]): DocPage {
  const sources = pluginReadmes.map((repoPath) => {
    const entry = entries.find((candidate) => repoPath === `packages/${candidate.id}/README.md`);
    return { repoPath, markdown: entry?.body ?? '' };
  });
  return { slug: pluginsSlug, ...pluginsPage, sources };
}

/**
 * Every docs page: the sidebar's pages in its order, then any doc it does not list.
 *
 * @returns The pages.
 */
export async function docPages(): Promise<DocPage[]> {
  const docs = (await getCollection('docs')).map(pageOfDoc);
  const pages = [...docs, pluginsPageOf(await getCollection('pluginReadmes'))];
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
    .map((source) => rewriteMarkdownLinks(source.markdown, source.repoPath, siteBase).trim())
    .join('\n\n');
  // A page made of several files gets its own title; a doc has its own first heading.
  return page.sources.length > 1 ? `# ${page.title}\n\n${page.description}\n\n${body}` : body;
}
