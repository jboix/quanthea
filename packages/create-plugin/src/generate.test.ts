import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlugin, type Setup, tsString } from './generate.ts';
import type { Draft } from './questions.ts';

const work = mkdtempSync(join(tmpdir(), 'quanthea-create-plugin-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A run without prompts into the temporary folder. */
const setup: Setup = {
  templates: join(import.meta.dir, '../templates'),
  cwd: work,
  kit: '^0.2.0',
  versions: { bun: '1.4.2', biome: '2.5.14', typescript: '~6.0.3', typesBun: '1.4.2' },
  year: 2026,
  gitName: 'Ada Lovelace',
  interactive: false,
};

/**
 * Generates a project and reads one of its files.
 *
 * @param given - The flags.
 * @returns A reader of the project's files.
 */
async function generated(given: Draft) {
  const { folder } = await createPlugin({ author: 'Ada Lovelace', ...given }, setup);
  return (path: string) => readFileSync(join(folder, path), 'utf8');
}

describe('the generator', () => {
  test('writes a SQL plugin in the ansi dialect, with its styles and the kit range', async () => {
    const read = await generated({ name: '@acme/quanthea-plugin-duck-lake', placeholders: '$1' });
    const plugin = read('src/plugin.ts');
    expect(plugin).toContain("kind: 'duck-lake',");
    expect(plugin).toContain("const displayName = 'Duck lake';");
    expect(plugin).toContain(
      "dialect: 'ansi',\n      placeholders: '$1',\n      rowLimit: 'fetch',",
    );
    const manifest = JSON.parse(read('package.json'));
    expect(manifest).toMatchObject({
      name: '@acme/quanthea-plugin-duck-lake',
      keywords: ['quanthea-plugin', 'quanthea'],
      quanthea: { kitVersion: 0, main: 'dist/plugin.js' },
      devDependencies: { '@quanthea/plugin-kit': '^0.2.0' },
    });
    expect(read('.gitignore')).toContain('node_modules');
    expect(read('LICENSE')).toContain('Copyright (c) 2026 Ada Lovelace');
    expect(read('README.md')).toContain(
      'quanthea plugin install ./acme-quanthea-plugin-duck-lake-0.1.0.tgz',
    );
  });

  test('writes no SQL fields for another language, and its fixture queries', async () => {
    const read = await generated({ name: 'quanthea-plugin-metrics', language: 'promql' });
    expect(read('src/plugin.ts')).not.toContain('dialect');
    expect(read('test/plugin.test.ts')).toContain("query: { language: 'promql', expr: 'up'");
  });

  test('refuses a folder that holds files', async () => {
    mkdirSync(join(work, 'taken'));
    writeFileSync(join(work, 'taken', 'notes.md'), 'mine');
    await expect(
      createPlugin({ name: 'quanthea-plugin-taken', author: 'Ada' }, { ...setup, dir: 'taken' }),
    ).rejects.toThrow('holds files already');
  });

  test('quotes free text the way Biome writes it', () => {
    expect(tsString('Duck lake')).toBe("'Duck lake'");
    expect(tsString("Ada's lake")).toBe('"Ada\'s lake"');
    expect(tsString('a \\ b\nc')).toBe("'a \\\\ b\\nc'");
  });
});
