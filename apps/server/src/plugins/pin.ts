/**
 * A plugin's pin: one SHA-256 over its manifest and its bundle, each with its length first, so no
 * two different pairs of files give the same input. `querent plugin install` prints it; the loader
 * recomputes it before running anything.
 */

/**
 * The pin of a plugin's two files.
 *
 * @param manifest - The `package.json` bytes, as installed.
 * @param bundle - The bundle bytes, as installed.
 * @returns Such as `sha256:4f0c…`.
 */
export function pinOf(manifest: Uint8Array, bundle: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(`querent-plugin-pin-1\n${manifest.byteLength}\n`);
  hasher.update(manifest);
  hasher.update(`\n${bundle.byteLength}\n`);
  hasher.update(bundle);
  return `sha256:${hasher.digest('hex')}`;
}

/**
 * The folder a plugin is installed in, under the plugins directory: its package name without the
 * `@`, the scope and the name joined by `__`.
 *
 * @param name - The package name, checked.
 * @returns Such as `acme__querent-plugin-sqlite`.
 */
export function folderOf(name: string): string {
  return name.replace(/^@/, '').replace('/', '__');
}

/** The file names in a plugin's folder. */
export const pluginFiles = { manifest: 'package.json', bundle: 'plugin.js' } as const;
