/**
 * Extracts the docs of each released version the site serves from its git tag, into `.versions/`,
 * which git ignores: the repository holds the current docs only. Run before the build and the dev
 * server. Without git or tags, it writes an empty list, and the site serves the current docs alone.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { pickVersions, versionsDir } from '../src/lib/versions.ts';

/** The repository root, which `git archive` takes paths from. */
const repoRoot = new URL('../../../', import.meta.url).pathname;

/** What each version's site renders: its docs, and the plugin packages' READMEs. */
const extracted = ['docs', 'packages/create-plugin/README.md', 'packages/plugin-kit/README.md'];

/**
 * Runs git, returning what it printed.
 *
 * @param args - The arguments.
 * @returns The output, or `undefined` when git failed.
 */
function git(args: readonly string[]): string | undefined {
  const run = Bun.spawnSync(['git', ...args], { cwd: repoRoot, stderr: 'pipe' });
  return run.exitCode === 0 ? run.stdout.toString() : undefined;
}

/**
 * Extracts one tag's docs into a folder.
 *
 * @param tag - The tag.
 * @param folder - The folder, emptied first.
 * @throws {Error} When the tag cannot be read.
 */
function extract(tag: string, folder: URL): void {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const archive = Bun.spawnSync(['git', 'archive', '--format=tar', tag, ...extracted], {
    cwd: repoRoot,
  });
  if (archive.exitCode !== 0) throw new Error(`git archive ${tag}: ${archive.stderr.toString()}`);
  const untar = Bun.spawnSync(['tar', '-x', '-C', folder.pathname], { stdin: archive.stdout });
  if (untar.exitCode !== 0) throw new Error(`tar ${tag}: ${untar.stderr.toString()}`);
}

/** The files a version's docs show as images. */
const image = /\.(webp|png|jpe?g|gif|svg)$/i;

/**
 * Lists the files under a folder, recursively.
 *
 * @param folder - The folder.
 * @returns The files' paths.
 */
function filesOf(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? filesOf(path) : [path];
  });
}

/**
 * Replaces each image of a version that is the same as the current one with a link to it. Astro
 * names an image by its name and content, so an identical copy would share the current file's name,
 * and the build drops a name only the copy's processed forms use, which the pages that import the
 * current file need. A link makes the two one file again.
 *
 * @param folder - The version's folder.
 */
function linkSameImages(folder: URL): void {
  const root = folder.pathname;
  for (const file of filesOf(root).filter((path) => image.test(path))) {
    const current = join(repoRoot, relative(root, file));
    if (!existsSync(current) || !readFileSync(current).equals(readFileSync(file))) continue;
    rmSync(file);
    symlinkSync(current, file);
  }
}

const tags = (git(['tag', '--list', 'v*']) ?? '').split('\n').filter(Boolean);
const versions = pickVersions(tags);
rmSync(versionsDir, { recursive: true, force: true });
mkdirSync(versionsDir, { recursive: true });
for (const version of versions) {
  const folder = new URL(`${version.id}/`, versionsDir);
  extract(version.tag, folder);
  linkSameImages(folder);
}
writeFileSync(new URL('versions.json', versionsDir), `${JSON.stringify(versions, null, 2)}\n`);
const names = versions.map((version) => `${version.id} (${version.tag})`).join(', ');
process.stdout.write(
  versions.length === 0 ? 'No released docs: next only.\n' : `Docs versions: ${names}.\n`,
);
