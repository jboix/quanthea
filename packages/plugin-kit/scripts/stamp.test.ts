import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kitVersion } from '../src/kit.ts';
import { stamp, versionToBuild } from './stamp.ts';

/** The folders a test created, removed after it. */
const folders: string[] = [];

/**
 * Creates a `dist/` as the build leaves it: a manifest at the local version and a declaration.
 *
 * @param withDeclarations - Whether the build wrote `index.d.ts`.
 * @returns The folder.
 */
function builtDist(withDeclarations = true): string {
  const dist = mkdtempSync(join(tmpdir(), 'kit-dist-'));
  folders.push(dist);
  const manifest = { name: '@quanthea/plugin-kit', version: `${kitVersion}.0.0-local` };
  writeFileSync(join(dist, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (withDeclarations) writeFileSync(join(dist, 'index.d.ts'), 'export {};\n');
  return dist;
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('stamp', () => {
  test('writes the cut version into the built manifest and keeps the rest', () => {
    const dist = builtDist();
    stamp(dist, `${kitVersion}.4.2`);
    const manifest = JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'));
    expect(manifest).toEqual({ name: '@quanthea/plugin-kit', version: `${kitVersion}.4.2` });
  });

  test('refuses a dist/ the build has not written, rather than building it', () => {
    expect(() => stamp(builtDist(false), `${kitVersion}.4.2`)).toThrow('Build dist/ first');
    expect(() => stamp(join(tmpdir(), 'no-such-kit-dist'), `${kitVersion}.4.2`)).toThrow(
      'Build dist/ first',
    );
  });

  test('refuses a major version other than the kit version', () => {
    const dist = builtDist();
    expect(() => stamp(dist, `${kitVersion + 1}.0.0`)).toThrow('does not match kit version');
  });
});

describe('versionToBuild', () => {
  test('is the local version without one given', () => {
    expect(versionToBuild(undefined)).toBe(`${kitVersion}.0.0-local`);
  });
});
