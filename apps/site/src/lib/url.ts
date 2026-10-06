/**
 * Base-aware links. Every internal link and asset address goes through {@link link}, so the site
 * works at a domain's root (`/`) and under a path (`/quanthea/`).
 */

/**
 * Joins a base path and a site path.
 *
 * @param base - The base, such as `/` or `/quanthea`, with or without a trailing slash.
 * @param path - The path inside the site, such as `docs/deployment/`, with or without a leading
 * slash.
 * @returns The joined path, such as `/quanthea/docs/deployment/`.
 */
export function joinBase(base: string, path: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${path.replace(/^\/+/, '')}`;
}

/**
 * The address of a page or file of the site, under the configured base.
 *
 * @param path - The path inside the site. Pages end in `/`; files keep their extension.
 * @returns The path from the host's root.
 */
export function link(path = ''): string {
  return joinBase(import.meta.env.BASE_URL, path);
}

/**
 * The absolute address of a page or file of the site, for canonical links, feeds and crawlers.
 *
 * @param path - The path inside the site.
 * @param site - The site's origin, `Astro.site`.
 * @returns The absolute address.
 */
export function absoluteLink(path: string, site: URL | undefined): string {
  if (site === undefined) throw new Error('The site address is not configured.');
  return new URL(link(path), site).href;
}
