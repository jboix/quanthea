/**
 * The site's content: the repository's docs, read from `docs/` in place, and the READMEs of the
 * plugin packages. The files carry no frontmatter; the title comes from their first heading.
 */

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { docSlug, publishedDocs } from './lib/doc-paths.ts';

/** The published docs, read from `docs/` in place; any other file there is never read. */
const docs = defineCollection({
  loader: glob({
    pattern: [...publishedDocs],
    base: '../../docs',
    generateId: ({ entry }) => docSlug(entry),
  }),
});

/** The READMEs of the plugin generator and the plugin kit, rendered on the plugins page. */
const pluginReadmes = defineCollection({
  loader: glob({
    pattern: ['create-plugin/README.md', 'plugin-kit/README.md'],
    base: '../../packages',
    generateId: ({ entry }) => entry.split('/')[0] ?? entry,
  }),
});

export const collections = { docs, pluginReadmes };
