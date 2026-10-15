/**
 * A migration file never changes once it is on main: a nightly image may have run it on a
 * database already. Each schema change adds a new file. Before a push, every file on origin/main
 * must be the same at HEAD; after it, no commit on main since the rule may change, delete or
 * rename one. A file only on this machine can still change until it is pushed.
 */
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository's root: git runs there, since from a subdirectory it lists only that one. */
const repoRoot = join(import.meta.dir, '..', '..', '..', '..');

/** Where the migrations sit in the repository, as git names them. */
const repoPath = 'apps/server/src/db/migrations';

/** The last commit before the rule: changes to migrations up to it are history. */
const ruleSince = '0be09a8446457edc74e0d5bea002004f9dbb1ad8';

/**
 * Runs git in the repository.
 *
 * @param args - The arguments.
 * @returns What it printed, or `undefined` when git failed.
 */
function git(...args: string[]): string | undefined {
  const run = Bun.spawnSync(['git', ...args], { cwd: repoRoot });
  return run.success ? run.stdout.toString() : undefined;
}

/**
 * The lines git printed, without empty ones.
 *
 * @param output - What git printed.
 * @returns The lines.
 */
function lines(output: string | undefined): string[] {
  return (output ?? '').split('\n').filter((line) => line !== '');
}

test('the migrations on origin/main are unchanged at HEAD', () => {
  const names = lines(git('ls-tree', '--name-only', `origin/main:${repoPath}`));
  expect(names.length).toBeGreaterThan(0);
  const changed = names.filter((name) => {
    const file = join(repoRoot, repoPath, name);
    if (!existsSync(file)) return true;
    return git('show', `origin/main:${repoPath}/${name}`) !== readFileSync(file, 'utf8');
  });
  expect(changed).toEqual([]);
});

test('no commit since the rule changes, deletes or renames a migration', () => {
  expect(git('cat-file', '-e', `${ruleSince}^{commit}`)).toBeDefined();
  const changes = git(
    'log',
    '--diff-filter=MDR',
    '--format=%h %s',
    `${ruleSince}..HEAD`,
    '--',
    repoPath,
  );
  expect(lines(changes)).toEqual([]);
});
