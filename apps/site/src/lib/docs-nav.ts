/**
 * The docs sidebar: its groups, their order and each page's label, by slug. The docs themselves
 * carry no frontmatter, so this list is the one place the order lives.
 */
import { pluginsSlug } from './doc-paths.ts';

/** A page of the sidebar. */
export interface DocNavItem {
  /** The page's slug under `docs/`. */
  readonly slug: string;
  /** The label in the sidebar. */
  readonly label: string;
}

/** A group of the sidebar. */
export interface DocNavGroup {
  /** The group's heading. */
  readonly label: string;
  /** Its pages, in order. */
  readonly items: readonly DocNavItem[];
}

/** The sidebar. */
export const docNav: readonly DocNavGroup[] = [
  { label: 'Get started', items: [{ slug: 'getting-started', label: 'Getting started' }] },
  {
    label: 'Run and configure',
    items: [
      { slug: 'deployment', label: 'Deploy' },
      { slug: 'reverse-proxy', label: 'Behind a reverse proxy' },
      { slug: 'configuration', label: 'Configuration file' },
      { slug: 'environment', label: 'Environment variables' },
    ],
  },
  {
    label: 'User guide',
    items: [
      { slug: 'dashboards', label: 'Dashboards' },
      { slug: 'library', label: 'The library' },
      { slug: 'ask-and-explain', label: 'Ask and Explain' },
      { slug: 'snapshots', label: 'Snapshots' },
      { slug: 'alerts', label: 'Alerts' },
      { slug: 'reports', label: 'Reports' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { slug: 'users-and-sign-in', label: 'Users and sign-in' },
      { slug: 'data-sources', label: 'Data sources' },
      { slug: 'models-and-usage', label: 'Models and usage' },
      { slug: 'notifications', label: 'Notification channels' },
      { slug: 'bin-and-retention', label: 'History and retention' },
      { slug: 'queries-and-charts', label: 'Queries and charts' },
    ],
  },
  {
    label: 'Extend',
    items: [
      { slug: 'connectors', label: 'Connectors & plugins' },
      { slug: pluginsSlug, label: 'Plugins' },
    ],
  },
];

/** Every page of the sidebar, in order. */
export const docNavItems: readonly DocNavItem[] = docNav.flatMap((group) => group.items);

/**
 * The sidebar label of a page.
 *
 * @param slug - The page's slug.
 * @returns The label, or `undefined` for a page the sidebar does not list.
 */
export function docLabel(slug: string): string | undefined {
  return docNavItems.find((item) => item.slug === slug)?.label;
}
