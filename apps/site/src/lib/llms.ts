/**
 * The two llms.txt files: `llms.txt`, an index of the docs as Markdown links, and
 * `llms-full.txt`, every doc's Markdown in one file. Both follow the llms.txt convention and are
 * built from the docs collection and `facts.ts`.
 */
import { connectors } from '../data/facts.ts';
import { type DocPage, pageMarkdown } from './docs-content.ts';
import { docLabel } from './docs-nav.ts';
import { description, githubUrl } from './project.ts';

/** What `llms.txt` lists under "Optional": the specs and the project's own files, on GitHub. */
const optionalLinks = [
  { label: 'Dashboard spec', path: 'docs/dashboard-spec.md', about: 'the JSON a dashboard is.' },
  { label: 'Alert spec', path: 'docs/alert-spec.md', about: 'the JSON an alert is.' },
  { label: 'Report spec', path: 'docs/report-spec.md', about: 'the JSON a report is.' },
  { label: 'Contributing', path: 'docs/CONTRIBUTING.md', about: 'how to work on quanthea.' },
];

/**
 * The opening of both files: the name, the summary and what quanthea is.
 *
 * @returns The Markdown.
 */
function opening(): string {
  const sources = connectors.map((connector) => connector.name).join(', ');
  const summary = [
    'quanthea is a self-hosted web app. You describe a dashboard in a chat, an agent builds it',
    `against your data sources (${sources}), you refine it in the same thread,`,
    'and you pin the good ones. Pinned dashboards are versioned, searchable, and render without',
    'any model. It runs as one Docker image for linux/amd64 and linux/arm64, and keeps its state',
    'in SQLite. It is free and MIT licensed.',
  ];
  return ['# quanthea', '', `> ${description}`, '', summary.join(' ')].join('\n');
}

/**
 * The link line of a page.
 *
 * @param page - The page.
 * @param siteBase - The site's absolute base address.
 * @returns `- [Label](…/docs/<slug>.md): description`.
 */
function linkLine(page: DocPage, siteBase: string): string {
  const label = docLabel(page.slug) ?? page.title;
  return `- [${label}](${siteBase}docs/${page.slug}.md): ${page.description}`;
}

/**
 * `llms.txt`.
 *
 * @param pages - The docs pages, in sidebar order.
 * @param siteBase - The site's absolute base address, such as `https://quanthea.ch/`.
 * @returns The file's text.
 */
export function llmsIndex(pages: readonly DocPage[], siteBase: string): string {
  return [
    opening(),
    '',
    '## Docs',
    '',
    ...pages.map((page) => linkLine(page, siteBase)),
    '',
    '## Optional',
    '',
    ...optionalLinks.map((each) => `- [${each.label}](${githubUrl(each.path)}): ${each.about}`),
    '',
  ].join('\n');
}

/**
 * `llms-full.txt`.
 *
 * @param pages - The docs pages, in sidebar order.
 * @param siteBase - The site's absolute base address.
 * @returns The file's text: the opening, then each page's Markdown with absolute links.
 */
export function llmsFull(pages: readonly DocPage[], siteBase: string): string {
  const documents = pages.map((page) => pageMarkdown(page, siteBase));
  return `${[opening(), ...documents].join('\n\n---\n\n')}\n`;
}
