/**
 * An Astro integration that serves the web app's browser icons on the site, from
 * `apps/web/public/`, so the site keeps no copies. It copies them into the build and serves them
 * from the dev server.
 */
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/** The icons the site's pages link to, with their media types. */
export const brandIconFiles = {
  'favicon.svg': 'image/svg+xml',
  'favicon-32.png': 'image/png',
  'apple-touch-icon.png': 'image/png',
} as const;

/** A file name of {@link brandIconFiles}. */
type IconName = keyof typeof brandIconFiles;

/**
 * Whether a name is one of the icons.
 *
 * @param name - A file name.
 * @returns `true` for an icon of {@link brandIconFiles}.
 */
function isIconName(name: string): name is IconName {
  return Object.hasOwn(brandIconFiles, name);
}

/**
 * The integration.
 *
 * @param options - Where the icons are and the site's base path.
 * @param options.iconDirectory - The web app's `public/` directory.
 * @param options.base - The site's base path, such as `/` or `/quanthea`.
 * @returns The integration.
 */
export function brandIcons(options: { iconDirectory: URL; base: string }): AstroIntegration {
  const prefix = options.base.endsWith('/') ? options.base : `${options.base}/`;
  return {
    name: 'quanthea-brand-icons',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((request, response, next) => {
          const name = (request.url ?? '').split('?')[0]?.slice(prefix.length) ?? '';
          if (!(request.url ?? '').startsWith(prefix) || !isIconName(name)) return next();
          response.setHeader('Content-Type', brandIconFiles[name]);
          response.end(readFileSync(new URL(name, options.iconDirectory)));
        });
      },
      'astro:build:done': ({ dir }) => {
        for (const name of Object.keys(brandIconFiles)) {
          copyFileSync(fileURLToPath(new URL(name, options.iconDirectory)), new URL(name, dir));
        }
      },
    },
  };
}
