/**
 * `robots.txt`, built with the site: everything may be crawled, and the sitemap is named by its
 * absolute address.
 *
 * Crawlers read `robots.txt` only at a host's root. On a custom domain with the base `/` this
 * file is at the root and works as it is. Under a path such as `/quanthea` it is ignored, and the
 * sitemap has to be submitted in Search Console instead.
 */
import type { APIRoute } from 'astro';
import { absoluteLink } from '../lib/url.ts';

/**
 * The file.
 *
 * @param context - The build context, with the site's origin.
 * @param context.site - The site's origin.
 * @returns The text response.
 */
export const GET: APIRoute = ({ site }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${absoluteLink('sitemap-index.xml', site)}`,
  ];
  return new Response(`${body.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
