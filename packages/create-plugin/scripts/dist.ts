/**
 * Builds the publishable generator in `dist/`: `cli.js` for Node, the templates, the defaults a
 * generated project starts with, a generated `package.json`, the README and the licence. The
 * workspace's own `package.json` stays private; `npm publish packages/create-plugin/dist`
 * publishes this folder.
 *
 * Usage: `bun scripts/dist.ts [version]`. The release passes the version semantic-release cut,
 * from the `create-plugin-v*` tags; without one, the build is `0.0.0-local`.
 */
import { chmodSync, copyFileSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const repository = join(root, '../..');
const dist = join(root, 'dist');
const url = 'https://github.com/jboix/quanthea';

/**
 * Reads a JSON file.
 *
 * @param path - The file.
 * @returns Its value.
 */
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * The newest released kit version: its newest `plugin-kit-v*` tag, else npm's latest.
 *
 * @returns The version.
 * @throws {Error} When neither git nor npm knows one.
 */
async function newestKit(): Promise<string> {
  const tags = Bun.spawnSync(['git', 'tag', '--list', 'plugin-kit-v*', '--sort=-v:refname'], {
    cwd: repository,
  });
  const tag = tags.stdout.toString().split('\n')[0]?.trim();
  if (tag) return tag.replace('plugin-kit-v', '');
  const response = await fetch('https://registry.npmjs.org/@quanthea/plugin-kit/latest');
  const { version } = (await response.json()) as { version?: string };
  if (!version) throw new Error('No plugin-kit-v* tag and no version on npm.');
  return version;
}

/**
 * The versions a generated project starts with, from the repository's own tools.
 *
 * @returns The defaults.
 */
async function defaults(): Promise<Record<string, string>> {
  const { devDependencies } = readJson<{ devDependencies: Record<string, string> }>(
    join(repository, 'package.json'),
  );
  const bun = readFileSync(join(repository, '.tool-versions'), 'utf8').match(/^bun (\S+)/m)?.[1];
  if (!bun) throw new Error('.tool-versions names no Bun version.');
  return {
    kit: await newestKit(),
    bun,
    biome: devDependencies['@biomejs/biome'] ?? '',
    typescript: devDependencies.typescript ?? '',
    typesBun: devDependencies['@types/bun'] ?? '',
  };
}

/**
 * The manifest npm publishes: the bin, node-plop as the one dependency.
 *
 * @param version - The version to publish.
 * @returns The published manifest.
 */
function publishedManifest(version: string): Record<string, unknown> {
  const workspace = readJson<{ description: string; dependencies: Record<string, string> }>(
    join(root, 'package.json'),
  );
  return {
    name: '@quanthea/create-plugin',
    version,
    description: workspace.description,
    keywords: ['quanthea', 'plugin', 'create', 'generator'],
    license: 'MIT',
    author: 'Josep Boix Requesens',
    repository: { type: 'git', url: `git+${url}.git`, directory: 'packages/create-plugin' },
    homepage: `${url}/tree/main/packages/create-plugin#readme`,
    bugs: { url: `${url}/issues` },
    type: 'module',
    bin: { 'create-plugin': './cli.js' },
    engines: { node: '>=20' },
    dependencies: workspace.dependencies,
    publishConfig: { access: 'public' },
  };
}

/**
 * Bundles the command for Node, with node-plop left to the install.
 *
 * @returns Once written.
 * @throws {AggregateError} When Bun cannot bundle it.
 */
async function bundle(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(root, 'src/cli.ts')],
    outdir: dist,
    target: 'node',
    format: 'esm',
    external: ['node-plop'],
    banner: '#!/usr/bin/env node',
  });
  if (!result.success) throw new AggregateError(result.logs, 'The generator did not bundle.');
  chmodSync(join(dist, 'cli.js'), 0o755);
}

/**
 * Builds `dist/` from scratch.
 *
 * @returns Once every file is written.
 */
async function main(): Promise<void> {
  const version = process.argv[2] ?? '0.0.0-local';
  rmSync(dist, { recursive: true, force: true });
  await bundle();
  cpSync(join(root, 'templates'), join(dist, 'templates'), { recursive: true });
  writeFileSync(join(dist, 'defaults.json'), `${JSON.stringify(await defaults(), null, 2)}\n`);
  writeFileSync(
    join(dist, 'package.json'),
    `${JSON.stringify(publishedManifest(version), null, 2)}\n`,
  );
  copyFileSync(join(root, 'README.md'), join(dist, 'README.md'));
  copyFileSync(join(repository, 'LICENSE'), join(dist, 'LICENSE'));
  process.stdout.write(`Built @quanthea/create-plugin@${version} in ${dist}\n`);
}

await main();
