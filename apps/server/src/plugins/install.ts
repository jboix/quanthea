/**
 * Installs, lists and removes plugins in the plugins directory, for `querent plugin`. It needs no
 * database and no keys, so it runs in a Docker build. An install writes the two files into a
 * temporary folder inside the plugins directory, loads them there with the static checks, and
 * renames the folder into place only when they pass: a failed install leaves nothing behind.
 * Changes apply when the server restarts.
 */
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyConnectorKind } from '../connectors/_shared/index.ts';
import type { Logger } from '../lib/logger.ts';
import { loadPluginFolder, Refusal } from './load.ts';
import { readManifest } from './manifest.ts';
import { folderOf, pinOf, pluginFiles } from './pin.ts';
import { fetchPlugin, type SourceOptions } from './source.ts';

/** What installing needs. */
export interface InstallOptions extends SourceOptions {
  /** The plugins directory. */
  readonly dir: string;
  /** The built-in kinds, which a plugin's kinds may not clash with. */
  readonly offered: readonly AnyConnectorKind[];
  /** Where the checks log. */
  readonly logger: Logger;
}

/** A plugin installed. */
export interface Installed {
  /** Its package name. */
  readonly name: string;
  /** Its version. */
  readonly version: string;
  /** Its pin. */
  readonly pin: string;
  /** The kinds it adds. */
  readonly kinds: readonly string[];
  /** Its folder. */
  readonly folder: string;
}

/** Why a plugin cannot be installed. */
export class InstallError extends Error {}

/**
 * Checks the manifest's keyword, and its name against the one asked for.
 *
 * @param manifest - The manifest's text.
 * @param requested - The package name the spec named, if any.
 * @returns The name and the version.
 * @throws {InstallError} For a manifest that cannot be read, no `querent-plugin` keyword, or
 *   another name than the one asked for.
 */
function checkManifest(manifest: string, requested: string | undefined) {
  const read = readManifest(manifest);
  if ('problem' in read) throw new InstallError(read.problem);
  const { name, version, keywords } = read.manifest;
  if (!keywords?.includes('querent-plugin'))
    throw new InstallError('package.json lacks the querent-plugin keyword');
  if (requested !== undefined && requested !== name)
    throw new InstallError(`the package is named ${name}, not ${requested}`);
  return { name, version };
}

/**
 * Loads a plugin from its temporary folder with the static checks, refusing a clash with a
 * built-in kind. Its own pin is the one computed here, so the check of the pin passes.
 *
 * @param folder - The temporary folder.
 * @param options - The built-in kinds and the logger.
 * @returns The kinds it adds.
 * @throws {InstallError} When the plugin is refused.
 */
async function checkFolder(folder: string, options: InstallOptions): Promise<string[]> {
  try {
    const kinds = await loadPluginFolder(
      folder,
      {
        dir: options.dir,
        pins: {},
        allowUnpinned: true,
        offered: options.offered,
        logger: options.logger,
      },
      new Set(options.offered.map((kind) => kind.kind)),
    );
    return kinds.map((kind) => kind.kind);
  } catch (error) {
    if (error instanceof Refusal) throw new InstallError(error.message);
    throw error;
  }
}

/**
 * Moves a checked folder into place, replacing an older install of the same plugin.
 *
 * @param staged - The checked temporary folder.
 * @param target - Where the plugin goes.
 * @param dir - The plugins directory, for the older install's way out.
 */
function moveIntoPlace(staged: string, target: string, dir: string): void {
  const replaced = join(dir, `.replaced-${crypto.randomUUID()}`);
  let hadOne = true;
  try {
    renameSync(target, replaced);
  } catch {
    hadOne = false;
  }
  try {
    renameSync(staged, target);
  } catch (error) {
    if (hadOne) renameSync(replaced, target);
    throw error;
  }
  if (hadOne) rmSync(replaced, { recursive: true, force: true });
}

/**
 * Installs a plugin.
 *
 * @param spec - An npm name with an optional version or range, an `https://` tarball URL, or a
 *   local `.tgz` or `.js` path.
 * @param options - The plugins directory, the source options and the built-in kinds.
 * @returns What was installed, with the pin to paste.
 * @throws {InstallError} When the plugin is refused.
 */
export async function installPlugin(spec: string, options: InstallOptions): Promise<Installed> {
  const files = await fetchPlugin(spec, options);
  if (files.bundle.byteLength > options.maxBundleBytes)
    throw new InstallError(`the bundle is larger than ${options.maxBundleBytes} bytes`);
  const { name, version } = checkManifest(
    new TextDecoder().decode(files.manifest),
    files.requested,
  );
  mkdirSync(options.dir, { recursive: true });
  const staged = mkdtempSync(join(options.dir, '.install-'));
  try {
    await Bun.write(join(staged, pluginFiles.manifest), files.manifest);
    await Bun.write(join(staged, pluginFiles.bundle), files.bundle);
    const kinds = await checkFolder(staged, options);
    const folder = join(options.dir, folderOf(name));
    moveIntoPlace(staged, folder, options.dir);
    return { name, version, pin: pinOf(files.manifest, files.bundle), kinds, folder };
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

/** An installed plugin, as `querent plugin list` shows it. */
export interface Listed {
  /** Its folder name. */
  readonly folder: string;
  /** Its package name, when its manifest can be read. */
  readonly name?: string;
  /** Its version. */
  readonly version?: string;
  /** Whether it loads at the next start, as far as its pin says. */
  readonly state: 'pinned' | 'pin mismatch' | 'not pinned' | 'unreadable';
}

/**
 * One installed plugin's state.
 *
 * @param dir - The plugins directory.
 * @param folder - Its folder name.
 * @param pins - The pins of the configuration file.
 * @returns The state.
 */
async function listOne(
  dir: string,
  folder: string,
  pins: Readonly<Record<string, string>>,
): Promise<Listed> {
  const manifestFile = Bun.file(join(dir, folder, pluginFiles.manifest));
  const bundleFile = Bun.file(join(dir, folder, pluginFiles.bundle));
  if (!(await manifestFile.exists()) || !(await bundleFile.exists()))
    return { folder, state: 'unreadable' };
  const manifest = new Uint8Array(await manifestFile.arrayBuffer());
  const read = readManifest(new TextDecoder().decode(manifest));
  if ('problem' in read) return { folder, state: 'unreadable' };
  const { name, version } = read.manifest;
  const pin = pins[name];
  const actual = pinOf(manifest, new Uint8Array(await bundleFile.arrayBuffer()));
  const state = pin === undefined ? 'not pinned' : pin === actual ? 'pinned' : 'pin mismatch';
  return { folder, name, version, state };
}

/**
 * The installed plugins.
 *
 * @param dir - The plugins directory.
 * @param pins - The pins of the configuration file.
 * @returns Each plugin, in folder order.
 */
export async function listPlugins(
  dir: string,
  pins: Readonly<Record<string, string>>,
): Promise<Listed[]> {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  return Promise.all(names.map((folder) => listOne(dir, folder, pins)));
}

/**
 * Removes an installed plugin.
 *
 * @param dir - The plugins directory.
 * @param name - Its package name.
 * @returns Whether it was installed.
 */
export async function removePlugin(dir: string, name: string): Promise<boolean> {
  const listed = await listPlugins(dir, {});
  const found = listed.find((plugin) => plugin.name === name || plugin.folder === folderOf(name));
  if (!found) return false;
  rmSync(join(dir, found.folder), { recursive: true, force: true });
  return true;
}
