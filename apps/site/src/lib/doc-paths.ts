/**
 * Where each published Markdown file of the repository lives on the site, and where the rest of
 * the repository lives on GitHub. Pure path logic, shared by the remark plugin and the text
 * endpoints.
 */

/**
 * The docs the site publishes: what a person running quanthea reads, from the repository root's
 * `docs/`. The internals (architecture, the specs) and the project's policies stay on GitHub, and
 * nothing else under `docs/` is ever published. Each is published at its file name's slug, so the
 * names are unique across folders.
 */
export const publishedDocs = [
  'guide/getting-started.md',
  'deployment.md',
  'configuration.md',
  'environment.md',
  'guide/dashboards.md',
  'guide/library.md',
  'guide/ask-and-explain.md',
  'guide/snapshots.md',
  'guide/alerts.md',
  'guide/reports.md',
  'guide/users-and-sign-in.md',
  'guide/data-sources.md',
  'guide/models-and-usage.md',
  'guide/notifications.md',
  'guide/bin-and-retention.md',
  'guide/queries-and-charts.md',
  'connectors.md',
] as const;

/** The page that renders the plugin packages' READMEs. */
export const pluginsSlug = 'plugins';

/** The package READMEs the plugins page renders, by repository path. */
export const pluginReadmes = [
  'packages/create-plugin/README.md',
  'packages/plugin-kit/README.md',
] as const;

/**
 * The slug of a doc, from its file name, whatever folder it is in: lower case, with hyphens.
 *
 * @param fileName - The file name, such as `CODE_OF_CONDUCT.md` or `guide/alerts.md`.
 * @returns The slug, such as `code-of-conduct` or `alerts`.
 */
export function docSlug(fileName: string): string {
  return fileName
    .replace(/^.*\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

/**
 * The site slug a repository file is published at.
 *
 * @param repoPath - A path from the repository root, such as `docs/deployment.md`.
 * @returns The slug, or `undefined` when the site does not publish that file.
 */
export function publishedSlug(repoPath: string): string | undefined {
  if ((pluginReadmes as readonly string[]).includes(repoPath)) return pluginsSlug;
  const match = /^docs\/((?:guide\/)?[^/]+\.md)$/i.exec(repoPath);
  const file = match?.[1];
  if (file === undefined || !(publishedDocs as readonly string[]).includes(file)) return undefined;
  return docSlug(file);
}

/**
 * Applies one segment of a relative path to a list of directories.
 *
 * @param parts - The directories so far, or `undefined` once the path climbed above the root.
 * @param segment - The segment: `..`, `.`, empty, or a name.
 * @returns The directories after the segment.
 */
function step(parts: string[] | undefined, segment: string): string[] | undefined {
  if (parts === undefined) return undefined;
  if (segment === '..') return parts.length === 0 ? undefined : parts.slice(0, -1);
  return segment === '.' || segment === '' ? parts : [...parts, segment];
}

/**
 * Resolves a relative path against a directory, POSIX style, inside the repository.
 *
 * @param directory - The directory, from the repository root (`docs`, or `` for the root).
 * @param relative - The relative path, such as `../deploy/`.
 * @returns The path from the repository root, or `undefined` when it climbs above the root.
 */
export function resolveRepoPath(directory: string, relative: string): string | undefined {
  const start = directory === '' ? [] : directory.split('/');
  const parts = relative.split('/').reduce<string[] | undefined>(step, start);
  if (parts === undefined) return undefined;
  const trailing = relative.endsWith('/') && parts.length > 0 ? '/' : '';
  return parts.join('/') + trailing;
}

/**
 * The directory of a repository path.
 *
 * @param repoPath - A file's path from the repository root.
 * @returns Its directory, or `` for a file at the root.
 */
export function directoryOf(repoPath: string): string {
  const index = repoPath.lastIndexOf('/');
  return index === -1 ? '' : repoPath.slice(0, index);
}
