/**
 * Loads the connector plugins of the plugins directory, once, at startup. Each plugin is a folder
 * with its manifest and its bundle. A plugin is refused, with one log line saying why, when its
 * manifest is wrong, its pin does not match (or it has none and unpinned plugins are not
 * allowed), its module disagrees with its manifest, or a kind it adds fails the static checks or
 * clashes with a kind already offered. The bundle that runs is a private copy of the bytes the pin
 * was checked on, so a file swapped after the check never runs.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type AnyConnectorKind,
  hostKit,
  kindProblems,
  type PluginOrigin,
  type RegisteredKind,
} from '../connectors/_shared/index.ts';
import type { Logger } from '../lib/logger.ts';
import { type Manifest, readManifest } from './manifest.ts';
import { pinOf, pluginFiles } from './pin.ts';

/** What loading needs. */
export interface LoadOptions {
  /** The plugins directory. */
  readonly dir: string;
  /** The pin of each plugin, by package name. */
  readonly pins: Readonly<Record<string, string>>;
  /** Whether a plugin without a pin loads. */
  readonly allowUnpinned: boolean;
  /** The kinds offered already, which a plugin's kinds may not clash with. */
  readonly offered: readonly AnyConnectorKind[];
  /** Where each plugin loaded or refused is logged. */
  readonly logger: Logger;
}

/** A plugin's verified files. */
interface Verified {
  /** Its manifest. */
  readonly manifest: Manifest;
  /** Its bundle's bytes, which the pin covers. */
  readonly bundle: Uint8Array;
}

/** Why a plugin is refused. */
class Refusal extends Error {}

/**
 * Reads a plugin's files and checks its manifest and its pin.
 *
 * @param folder - The plugin's folder.
 * @param options - The pins and whether unpinned plugins load.
 * @returns The verified files.
 * @throws {Refusal} For a missing file, a wrong manifest, a pin mismatch or a missing pin.
 */
async function verify(folder: string, options: LoadOptions): Promise<Verified> {
  const read = async (name: string) => {
    const file = Bun.file(join(folder, name));
    if (!(await file.exists())) throw new Refusal(`no ${name}`);
    return new Uint8Array(await file.arrayBuffer());
  };
  const manifestBytes = await read(pluginFiles.manifest);
  const bundle = await read(pluginFiles.bundle);
  const parsed = readManifest(new TextDecoder().decode(manifestBytes));
  if ('problem' in parsed) throw new Refusal(parsed.problem);
  const { manifest } = parsed;
  const pin = options.pins[manifest.name];
  if (pin !== undefined && pin !== pinOf(manifestBytes, bundle))
    throw new Refusal(
      'pin mismatch: paste the snippet `querent plugin install` printed for this version into plugins.pins',
    );
  if (pin === undefined && !options.allowUnpinned)
    throw new Refusal(
      'not pinned: paste the snippet `querent plugin install` printed into plugins.pins, or set plugins.allowUnpinned',
    );
  return { manifest, bundle };
}

/**
 * Imports a private copy of the verified bundle and calls its default export with the live kit.
 *
 * @param verified - The verified files.
 * @returns What the plugin returned.
 * @throws {Refusal} When the module's kit version disagrees with its manifest, or it exports no
 *   plugin function, or the function throws.
 */
async function run(verified: Verified): Promise<unknown> {
  const copy = mkdtempSync(join(tmpdir(), 'querent-plugin-'));
  try {
    const path = join(copy, 'plugin.js');
    await Bun.write(path, verified.bundle);
    const module = (await import(pathToFileURL(path).href)) as {
      kitVersion?: unknown;
      default?: unknown;
    };
    if (module.kitVersion !== verified.manifest.querent.kitVersion)
      throw new Refusal('the module and package.json name different kit versions');
    if (typeof module.default !== 'function')
      throw new Refusal('the module exports no plugin function as default');
    return module.default(hostKit);
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal(`it failed to load: ${error instanceof Error ? error.message : error}`);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/**
 * Checks what a plugin returned: kinds that pass the static checks and clash with nothing offered.
 *
 * @param returned - What the plugin function returned.
 * @param taken - The kind identifiers offered already.
 * @returns The kinds.
 * @throws {Refusal} For no kinds, a kind that fails a check, or a clash.
 */
function checkKinds(returned: unknown, taken: ReadonlySet<string>): AnyConnectorKind[] {
  if (!Array.isArray(returned) || returned.length === 0)
    throw new Refusal('it returned no connector kinds');
  for (const kind of returned) {
    const problems = kindProblems(kind);
    if (problems.length > 0)
      throw new Refusal(`a kind fails the static checks: ${problems.join('; ')}`);
    const id = (kind as AnyConnectorKind).kind;
    if (taken.has(id)) throw new Refusal(`the kind "${id}" is offered already`);
  }
  return returned as AnyConnectorKind[];
}

/**
 * Loads one plugin.
 *
 * @param folder - Its folder.
 * @param options - The pins and the logger.
 * @param taken - The kind identifiers offered already.
 * @returns Its kinds, with their origin.
 * @throws {Refusal} When it is refused.
 */
async function loadOne(
  folder: string,
  options: LoadOptions,
  taken: ReadonlySet<string>,
): Promise<RegisteredKind[]> {
  const verified = await verify(folder, options);
  const kinds = checkKinds(await run(verified), taken);
  const plugin: PluginOrigin = {
    name: verified.manifest.name,
    version: verified.manifest.version,
  };
  if (options.pins[plugin.name] === undefined)
    options.logger.warn('plugin loaded without a pin', { plugin: plugin.name });
  return kinds.map((kind) => Object.freeze({ ...kind, plugin }));
}

/**
 * The plugin folders of the directory, in name order.
 *
 * @param dir - The plugins directory.
 * @returns The folders, none when the directory does not exist.
 */
function foldersOf(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .sort()
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isDirectory());
}

/**
 * Loads every plugin of the plugins directory.
 *
 * @param options - The directory, the pins, the kinds offered and the logger.
 * @returns The kinds the plugins add, with their origin.
 */
export async function loadPlugins(options: LoadOptions): Promise<RegisteredKind[]> {
  const taken = new Set(options.offered.map((kind) => kind.kind));
  const added: RegisteredKind[] = [];
  for (const folder of foldersOf(options.dir)) {
    try {
      const kinds = await loadOne(folder, options, taken);
      for (const kind of kinds) taken.add(kind.kind);
      added.push(...kinds);
      const [first] = kinds;
      options.logger.info('plugin loaded', {
        plugin: first?.plugin?.name,
        version: first?.plugin?.version,
        kinds: kinds.map((kind) => kind.kind).join(', '),
      });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      options.logger.warn('plugin refused', { folder, reason: error.message });
    }
  }
  return added;
}

/**
 * The pinned plugins that are not installed, to warn about.
 *
 * @param pins - The pins.
 * @param loaded - The kinds the plugins added.
 * @returns The package names.
 */
export function missingPinned(
  pins: Readonly<Record<string, string>>,
  loaded: readonly RegisteredKind[],
): string[] {
  const names = new Set(loaded.map((kind) => kind.plugin?.name));
  return Object.keys(pins).filter((name) => !names.has(name));
}
