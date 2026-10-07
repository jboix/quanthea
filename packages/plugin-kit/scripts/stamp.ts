/**
 * Writes the version semantic-release cut into the kit's built `dist/package.json`, and nothing
 * else. The release builds `dist/` before it mints its credentials, so no dev dependency (the
 * TypeScript compiler among them) runs while they exist; this step runs with them and uses Bun
 * alone.
 *
 * Usage: `bun scripts/stamp.ts <version>`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitVersion } from '../src/kit.ts';

/**
 * The version to build: the one given, whose major version must be the kit version.
 *
 * @param given - The version semantic-release cut, if any.
 * @returns The version, `<kitVersion>.0.0-local` without one given.
 * @throws {Error} When the major version is not {@link kitVersion}.
 */
export function versionToBuild(given: string | undefined): string {
  const version = given ?? `${kitVersion}.0.0-local`;
  if (Number(version.split('.')[0]) !== kitVersion)
    throw new Error(`Version ${version} does not match kit version ${kitVersion}.`);
  return version;
}

/**
 * Sets the version of a built `dist/`, keeping the rest of its manifest.
 *
 * @param dist - The folder `scripts/dist.ts` built.
 * @param version - The version semantic-release cut.
 * @throws {Error} When `dist/` holds no manifest or no declarations, or the major version is not
 *   {@link kitVersion}.
 */
export function stamp(dist: string, version: string): void {
  const manifestPath = join(dist, 'package.json');
  if (!existsSync(manifestPath) || !existsSync(join(dist, 'index.d.ts')))
    throw new Error(`Build dist/ first: scripts/dist.ts (nothing built in ${dist}).`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.version = versionToBuild(version);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) throw new Error('Usage: bun scripts/stamp.ts <version>');
  const dist = join(import.meta.dir, '..', 'dist');
  stamp(dist, version);
  process.stdout.write(`Stamped ${dist} with ${version}\n`);
}
