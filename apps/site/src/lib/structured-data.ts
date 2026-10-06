/**
 * The structured data (schema.org, as JSON-LD) the pages carry: the application on the home and
 * pricing pages, a breadcrumb trail on the docs.
 */
import { description, githubUrl, repositoryUrl, version } from './project.ts';
import { absoluteLink } from './url.ts';

/**
 * The application, as a `SoftwareApplication`.
 *
 * @param site - The site's origin, `Astro.site`.
 * @returns The JSON-LD object.
 */
export function softwareApplication(site: URL | undefined): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'quanthea',
    description,
    url: absoluteLink('', site),
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Linux (Docker)',
    softwareVersion: version,
    license: githubUrl('LICENSE'),
    sameAs: repositoryUrl,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}

/**
 * The trail from the docs index to a doc, as a `BreadcrumbList`.
 *
 * @param site - The site's origin.
 * @param title - The doc's title.
 * @param path - The doc's path inside the site, such as `docs/deployment/`.
 * @returns The JSON-LD object.
 */
export function docBreadcrumbs(
  site: URL | undefined,
  title: string,
  path: string,
): Record<string, unknown> {
  const items = [
    { name: 'quanthea', path: '' },
    { name: 'Docs', path: 'docs/' },
    { name: title, path },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteLink(item.path, site),
    })),
  };
}

/**
 * Serializes JSON-LD for a `<script>` element, so no value can close the element.
 *
 * @param data - The JSON-LD object.
 * @returns The JSON text, with `<` escaped.
 */
export function jsonLdText(data: Record<string, unknown>): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c');
}
