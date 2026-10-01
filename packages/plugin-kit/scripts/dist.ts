/**
 * Builds the publishable kit in `dist/`: the bundled entries, their declarations, a generated
 * `package.json`, the README and the licence. The workspace's own `package.json` points at the
 * sources and stays private; `npm publish packages/plugin-kit/dist` publishes this folder.
 */
import { copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const dist = join(root, 'dist');
const repository = 'https://github.com/jboix/quanthea';

/** The entries plugin authors import: the types and the test kit. `host` and `contract` stay. */
const entries = ['index', 'testing'] as const;

/** What the published manifest takes from the workspace's. */
interface WorkspaceManifest {
  /** The package name. */
  readonly name: string;
  /** The kit's version. */
  readonly version: string;
  /** One line about the package. */
  readonly description: string;
  /** The runtime dependencies, zod alone. */
  readonly dependencies: Readonly<Record<string, string>>;
}

/**
 * Bundles each entry into an ES module, with zod and `bun:test` left to the plugin's install.
 *
 * @returns Once written.
 * @throws {AggregateError} When Bun cannot bundle an entry.
 */
async function bundle(): Promise<void> {
  const result = await Bun.build({
    entrypoints: entries.map((entry) => join(root, 'src', `${entry}.ts`)),
    outdir: dist,
    target: 'bun',
    format: 'esm',
    splitting: true,
    external: ['zod', 'bun:test'],
  });
  if (!result.success) throw new AggregateError(result.logs, 'The kit did not bundle.');
}

/**
 * Writes the declarations with the installed TypeScript, then points their relative imports at
 * `.js`, as the published files are named.
 *
 * @throws {Error} When TypeScript reports an error.
 */
function declare(): void {
  const tsc = Bun.resolveSync('typescript/bin/tsc', root);
  const emitted = Bun.spawnSync([process.execPath, tsc, '-p', 'tsconfig.build.json'], {
    cwd: root,
  });
  if (emitted.exitCode !== 0) throw new Error(`tsc failed:\n${emitted.stdout}${emitted.stderr}`);
  const relativeTs = /((?:from|import)\s*\(?\s*['"]\.{1,2}\/[^'"]+)\.ts(['"])/g;
  for (const file of readdirSync(dist).filter((name) => name.endsWith('.d.ts'))) {
    const path = join(dist, file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(relativeTs, '$1.js$2'));
  }
}

/**
 * The manifest npm publishes: the entries pointing at `dist`, zod as the one dependency.
 *
 * @param workspace - The workspace's manifest.
 * @returns The published manifest.
 */
function publishedManifest(workspace: WorkspaceManifest): Record<string, unknown> {
  const entry = (name: string) => ({ types: `./${name}.d.ts`, default: `./${name}.js` });
  return {
    name: workspace.name,
    version: workspace.version,
    description: workspace.description,
    keywords: ['quanthea', 'connector', 'plugin', 'kit'],
    license: 'MIT',
    author: 'Josep Boix Requesens',
    repository: { type: 'git', url: `git+${repository}.git`, directory: 'packages/plugin-kit' },
    homepage: `${repository}/tree/main/packages/plugin-kit#readme`,
    bugs: { url: `${repository}/issues` },
    type: 'module',
    sideEffects: false,
    exports: {
      '.': entry('index'),
      './testing': entry('testing'),
      './package.json': './package.json',
    },
    dependencies: { zod: workspace.dependencies.zod },
    publishConfig: { access: 'public' },
  };
}

/**
 * Builds `dist/` from scratch.
 *
 * @returns Once every file is written.
 */
async function main(): Promise<void> {
  rmSync(dist, { recursive: true, force: true });
  await bundle();
  declare();
  const workspace = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = publishedManifest(workspace as WorkspaceManifest);
  writeFileSync(join(dist, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  copyFileSync(join(root, 'README.md'), join(dist, 'README.md'));
  copyFileSync(join(root, '../../LICENSE'), join(dist, 'LICENSE'));
  process.stdout.write(`Built ${manifest.name}@${manifest.version} in ${dist}\n`);
}

await main();
