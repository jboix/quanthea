/**
 * The website's build: static pages only, with the address and base path from the environment.
 * On a custom domain the site sits at the root (`/`); as a project page it sits under `/quanthea`.
 */
import { fileURLToPath } from 'node:url';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import { defineConfig, passthroughImageService } from 'astro/config';
import { brandIcons } from './src/lib/brand-icons.ts';
import { remarkDocLinks } from './src/lib/remark-doc-links.ts';
import { remarkDocTitle } from './src/lib/remark-doc-title.ts';
import { remarkSchemeImages } from './src/lib/remark-scheme-images.ts';

/** The site's origin, such as `https://quanthea.ch`. */
const site = process.env.SITE_URL || 'https://quanthea.ch';

/** The path the site sits under: `/` on its own domain. */
const base = process.env.SITE_BASE || '/';

/** The repository root, which the docs' relative links start from. */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  site,
  base,
  output: 'static',
  // Every page is a directory with an index.html, so every page link ends in a slash.
  trailingSlash: 'always',
  // Pages carry their small stylesheets inline, so no request blocks the first paint.
  build: { format: 'directory', inlineStylesheets: 'always' },
  // Images are copied as they are: no image service runs at build time or on demand.
  image: { service: passthroughImageService() },
  devToolbar: { enabled: false },
  // Astro 7 strips whitespace between inline elements by JSX rules; the pages are written for
  // HTML's, where a line break between two inline elements is a space.
  compressHTML: true,
  // Mermaid's chunks are large; they load only on a doc page that has a diagram.
  vite: { build: { chunkSizeWarningLimit: 700 } },
  integrations: [
    sitemap({ filter: (page) => !/\/404\/?$/.test(page) }),
    brandIcons({ iconDirectory: new URL('../web/public/', import.meta.url), base }),
  ],
  markdown: {
    // Mermaid blocks stay as code; the docs layout draws them in the browser.
    syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] },
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false },
    // The docs' links, titles and scheme images are remark plugins, so the docs keep the
    // remark pipeline rather than Astro 7's own Markdown processor.
    processor: unified({
      remarkPlugins: [
        [remarkDocTitle, { demote: ['/packages/'] }],
        [remarkDocLinks, { base, repoRoot }],
        remarkSchemeImages,
      ],
    }),
  },
});
