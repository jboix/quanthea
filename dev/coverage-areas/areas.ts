/**
 * Line coverage by area, from the lcov file `bun run test:coverage` writes: by workspace, the
 * server by module, and the web app by part. octocov shows the sets as custom metrics under its
 * total, so a pull request says which part the number comes from. Bun counts only the files the
 * tests load, so an area no test touches is absent rather than at zero.
 */

/** One file's line counts, from its lcov record. */
export interface FileLines {
  readonly path: string;
  readonly found: number;
  readonly hit: number;
}

/** One metric of a custom metrics set, as octocov reads it. */
interface Metric {
  readonly key: string;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
}

/** A custom metrics set, as octocov reads it. */
export interface MetricSet {
  readonly key: string;
  readonly name: string;
  readonly metrics: readonly Metric[];
}

/** The workspaces, by their folder, with the names the tables use. */
const workspaces: Readonly<Record<string, string>> = {
  'apps/server': 'server',
  'apps/web': 'web app',
  'apps/site': 'website',
  'packages/shared': 'shared',
  'packages/plugin-kit': 'plugin kit',
  'packages/create-plugin': 'plugin generator',
  'packages/tokens': 'tokens',
  examples: 'example plugins',
  dev: 'dev tools',
  evals: 'evals',
};

/**
 * The files of an lcov report with their line counts. Files outside the repository, which some
 * tests load from a temporary folder, are left out.
 *
 * @param lcov - The report's text.
 * @returns Each file's line counts.
 */
export function filesOf(lcov: string): FileLines[] {
  return lcov
    .split('end_of_record')
    .map((record) => ({
      path: /^SF:(.*)$/m.exec(record)?.[1]?.trim() ?? '',
      found: Number(/^LF:(\d+)$/m.exec(record)?.[1] ?? 0),
      hit: Number(/^LH:(\d+)$/m.exec(record)?.[1] ?? 0),
    }))
    .filter((file) => file.path !== '' && !file.path.startsWith('..') && file.found > 0);
}

/**
 * The workspace a file belongs to.
 *
 * @param path - The file's path from the repository root.
 * @returns The workspace's name, or `undefined` outside them.
 */
function workspaceOf(path: string): string | undefined {
  const folder = Object.keys(workspaces).find((each) => path.startsWith(`${each}/`));
  return folder === undefined ? undefined : workspaces[folder];
}

/**
 * The first folder of a file under a source root, such as `agent` for the server's
 * `apps/server/src/agent/run.ts`; a file right under the root counts as `(root)`.
 *
 * @param root - The source root, such as `apps/server/src/`.
 * @returns The grouping, which leaves out the files outside the root.
 */
function folderUnder(root: string): (path: string) => string | undefined {
  return (path) => {
    if (!path.startsWith(root)) return undefined;
    const rest = path.slice(root.length);
    return rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : '(root)';
  };
}

/**
 * One set: the line coverage of each group, the largest first, each named with its line count.
 *
 * @param key - The set's key.
 * @param name - The set's title.
 * @param files - Every file.
 * @param groupOf - Which group a file belongs to, if any.
 * @returns The set.
 */
function setOf(
  key: string,
  name: string,
  files: readonly FileLines[],
  groupOf: (path: string) => string | undefined,
): MetricSet {
  const groups = new Map<string, { found: number; hit: number }>();
  for (const file of files) {
    const group = groupOf(file.path);
    if (group === undefined) continue;
    const sum = groups.get(group) ?? { found: 0, hit: 0 };
    groups.set(group, { found: sum.found + file.found, hit: sum.hit + file.hit });
  }
  const metrics = [...groups]
    .sort(([, left], [, right]) => right.found - left.found)
    .map(([group, sum]) => ({
      key: group.replace(/[^a-z0-9]+/gi, '_').toLowerCase(),
      name: `${group} (${sum.found.toLocaleString('en-US')} lines)`,
      value: Math.round((sum.hit / sum.found) * 1000) / 10,
      unit: '%',
    }));
  return { key, name, metrics };
}

/**
 * The three sets: by workspace, the server by module, the web app by part.
 *
 * @param files - Every file of the report.
 * @returns The sets, in that order.
 */
export function areaSets(files: readonly FileLines[]): MetricSet[] {
  return [
    setOf('coverage_by_workspace', 'Line coverage by workspace', files, workspaceOf),
    setOf('server_coverage', 'Server, by module', files, folderUnder('apps/server/src/')),
    setOf('web_coverage', 'Web app, by part', files, folderUnder('apps/web/src/')),
  ];
}

/**
 * A set as a Markdown table, for the terminal.
 *
 * @param set - The set.
 * @returns The table, with its title.
 */
export function tableOf(set: MetricSet): string {
  const rows = set.metrics.map((metric) => `| ${metric.name} | ${metric.value}% |`);
  return [`### ${set.name}`, '', '| Area | Lines |', '| --- | ---: |', ...rows].join('\n');
}
