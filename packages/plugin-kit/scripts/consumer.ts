/**
 * Proves an outside author can use the published kit: packs `dist/`, installs the tarball in a
 * temporary project outside the repository with a copy of the SQLite example, then typechecks,
 * builds and tests the example there. Run it after `dist.ts`; `check:package` chains them.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const kit = join(import.meta.dir, '..');
const repository = join(kit, '../..');
const example = join(repository, 'examples/quanthea-plugin-sqlite');

/**
 * Runs a command and stops on failure.
 *
 * @param command - The command, Bun first.
 * @param cwd - Where to run it.
 * @throws {Error} With the command's output, when it exits with an error.
 */
function run(command: readonly string[], cwd: string): void {
  const result = Bun.spawnSync([...command], { cwd, env: { ...process.env, NO_COLOR: '1' } });
  if (result.exitCode === 0) return;
  throw new Error(`${command.join(' ')} failed in ${cwd}:\n${result.stdout}${result.stderr}`);
}

/**
 * Reads a JSON file.
 *
 * @param path - The file.
 * @returns Its value.
 */
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Packs `dist/` as npm would publish it.
 *
 * @param into - The folder to write the tarball in.
 * @returns The tarball's file name.
 * @throws {Error} When `dist/` is missing or holds no tarball after packing.
 */
function pack(into: string): string {
  const dist = join(kit, 'dist');
  if (!existsSync(join(dist, 'package.json')))
    throw new Error('Build dist/ first: scripts/dist.ts');
  run([process.execPath, 'pm', 'pack', '--destination', into], dist);
  const tarball = readdirSync(into).find((name) => name.endsWith('.tgz'));
  if (!tarball) throw new Error(`bun pm pack wrote no tarball in ${into}`);
  return tarball;
}

/**
 * Writes the example as its own project: its sources and tests, its manifest with the kit from
 * the tarball, and a standalone tsconfig with the repository's compiler options.
 *
 * @param work - The project folder.
 * @param tarball - The kit's tarball, in that folder.
 */
async function project(work: string, tarball: string): Promise<void> {
  for (const folder of ['src', 'test'])
    cpSync(join(example, folder), join(work, folder), { recursive: true });
  const root = readJson(join(repository, 'package.json')) as {
    devDependencies: Record<string, string>;
  };
  const manifest = readJson(join(example, 'package.json'));
  manifest.devDependencies = {
    '@quanthea/plugin-kit': `./${tarball}`,
    '@types/bun': root.devDependencies['@types/bun'],
    typescript: root.devDependencies.typescript,
  };
  await Bun.write(join(work, 'package.json'), JSON.stringify(manifest, null, 2));
  const base = readJson(join(repository, 'tsconfig.base.json')) as { compilerOptions: object };
  const own = readJson(join(example, 'tsconfig.json')) as {
    compilerOptions: object;
    include: string[];
  };
  const compilerOptions = { ...base.compilerOptions, ...own.compilerOptions };
  await Bun.write(
    join(work, 'tsconfig.json'),
    JSON.stringify({ compilerOptions, include: own.include }),
  );
}

/**
 * Installs, typechecks, builds and tests the example against the packed kit.
 *
 * @returns Once every step passed.
 */
async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'quanthea-kit-consumer-'));
  try {
    await project(work, pack(work));
    run([process.execPath, 'install'], work);
    if (existsSync(join(work, 'node_modules/@quanthea/plugin-kit/src')))
      throw new Error('The kit resolved to its sources, not to the packed tarball.');
    run([process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit', '-p', '.'], work);
    run([process.execPath, 'run', 'build'], work);
    run([process.execPath, 'test'], work);
    process.stdout.write(
      'The SQLite example typechecks, builds and passes its tests on the packed kit.\n',
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
