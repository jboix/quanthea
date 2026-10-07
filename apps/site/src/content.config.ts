/**
 * The site's content, one set per version of the docs: `next` reads the repository's `docs/` and the
 * plugin packages' READMEs in place; each released version reads the same files as its tag held
 * them, from `.versions/` (see `scripts/versions.ts`). The files carry no frontmatter; the title
 * comes from their first heading.
 */

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { docSlug, publishedDocs } from './lib/doc-paths.ts';
import { releasedVersions } from './lib/versions.ts';

/**
 * The published docs of one version; any other file there is never read.
 *
 * @param base - The folder holding the version's `docs/` files.
 * @returns The collection.
 */
function docsOf(base: string) {
  return defineCollection({
    loader: glob({ pattern: [...publishedDocs], base, generateId: ({ entry }) => docSlug(entry) }),
  });
}

/**
 * The READMEs of the plugin generator and the plugin kit of one version, for the plugins page.
 *
 * @param base - The folder holding the version's `packages/` folders.
 * @returns The collection.
 */
function readmesOf(base: string) {
  return defineCollection({
    loader: glob({
      pattern: ['create-plugin/README.md', 'plugin-kit/README.md'],
      base,
      generateId: ({ entry }) => entry.split('/')[0] ?? entry,
    }),
  });
}

/** Each released version's collections, named after it, such as `docs_v0_4`. */
const released = Object.fromEntries(
  releasedVersions().flatMap((version) => {
    const name = version.id.replaceAll('.', '_');
    const root = `./.versions/${version.id}`;
    return [
      [`docs_${name}`, docsOf(`${root}/docs`)],
      [`pluginReadmes_${name}`, readmesOf(`${root}/packages`)],
    ];
  }),
);

export const collections = {
  docs: docsOf('../../docs'),
  pluginReadmes: readmesOf('../../packages'),
  ...released,
};
