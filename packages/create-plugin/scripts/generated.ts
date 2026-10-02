/**
 * Proves the generator's projects work: runs the built `dist/cli.js` with Node, as npm create
 * does, once per query language and once for a built-in SQL dialect, with the kit from its packed
 * tarball. Each project installs and passes its own `bun run verify`, and the ansi one installs
 * into quanthea with `quanthea plugin install`. Run it after both `dist.ts` scripts;
 * `check:package` chains them.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const repository = join(root, '../..');

/** The projects to generate: their folder and their flags. */
const cases: readonly (readonly [string, readonly string[]])[] = [
  ['sql-ansi', ['--language', 'sql', '--dialect', 'ansi', '--placeholders', '$1']],
  ['sql-postgres', ['--language', 'sql', '--dialect', 'postgres']],
  ['promql', ['--language', 'promql']],
  ['search', ['--language', 'search']],
  ['logql', ['--language', 'logql']],
  ['http', ['--language', 'http']],
  ['redis', ['--language', 'redis']],
  ['mongodb', ['--language', 'mongodb']],
];

/**
 * Runs a command and stops on failure.
 *
 * @param command - The command.
 * @param cwd - Where to run it.
 * @param env - Extra environment variables.
 * @returns Its output.
 * @throws {Error} With the command's output, when it exits with an error.
 */
function run(command: readonly string[], cwd: string, env: Record<string, string> = {}): string {
  const result = Bun.spawnSync([...command], {
    cwd,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed in ${cwd}:\n${output}`);
  return output;
}

/**
 * Packs the kit's `dist/` as npm would publish it.
 *
 * @param into - The folder to write the tarball in.
 * @returns The tarball's path.
 * @throws {Error} When the kit's `dist/` is missing.
 */
function packKit(into: string): string {
  const dist = join(repository, 'packages/plugin-kit/dist');
  if (!existsSync(join(dist, 'package.json'))) throw new Error('Build the kit first: dist.ts');
  run([process.execPath, 'pm', 'pack', '--destination', into], dist);
  const tarball = readdirSync(into).find((name) => name.endsWith('.tgz'));
  if (!tarball) throw new Error(`bun pm pack wrote no tarball in ${into}`);
  return join(into, tarball);
}

/**
 * Generates one project with Node, installs it and runs its checks.
 *
 * @param work - The folder projects are made in.
 * @param kit - The kit tarball.
 * @param folder - The project's folder.
 * @param flags - Its flags.
 * @returns The project's folder.
 */
function generate(work: string, kit: string, folder: string, flags: readonly string[]): string {
  const node = Bun.which('node');
  if (!node) throw new Error('Node is needed: the generator runs on Node.');
  const identity = ['--name', `quanthea-plugin-e2e-${folder}`, '--author', 'Test', '--yes'];
  const where = ['--dir', folder, '--kit', `file:${kit}`];
  run([node, join(root, 'dist/cli.js'), ...identity, ...where, ...flags], work);
  const project = join(work, folder);
  run([process.execPath, 'install'], project);
  run([process.execPath, 'run', 'verify'], project);
  return project;
}

/**
 * Packs a generated project and installs it with quanthea's command.
 *
 * @param work - The folder to install into.
 * @param project - The project.
 * @throws {Error} When quanthea refuses it.
 */
function install(work: string, project: string): void {
  run([process.execPath, 'pm', 'pack', '--destination', work], project);
  const tarball = readdirSync(work).find((name) => name.startsWith('quanthea-plugin-e2e-'));
  if (!tarball) throw new Error('The project packed no tarball.');
  const cli = join(repository, 'apps/server/src/cli.ts');
  const environment = { QUANTHEA_DATA_DIR: join(work, 'data') };
  const output = run(
    [process.execPath, cli, 'plugin', 'install', join(work, tarball)],
    work,
    environment,
  );
  if (!output.includes('Installed quanthea-plugin-e2e-sql-ansi')) throw new Error(output);
}

/**
 * Generates, checks and installs every case.
 *
 * @returns Once every case passed.
 */
function main(): void {
  const work = mkdtempSync(join(tmpdir(), 'quanthea-generated-'));
  try {
    const kit = packKit(work);
    const projects = cases.map(([folder, flags]) => generate(work, kit, folder, flags));
    install(work, projects[0] ?? '');
    process.stdout.write(
      `The generator's ${cases.length} projects install, pass their checks, and one installs into quanthea.\n`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
