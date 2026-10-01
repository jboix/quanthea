/**
 * `querent plugin install <spec>`, `querent plugin list` and `querent plugin remove <name>`. They
 * read the configuration for the plugins directory and the pins, and nothing else: no database,
 * no keys. Install prints the pin to paste into the configuration file, which it never writes.
 */
import { loadConfig } from '../config/config.ts';
import { connectorKinds } from '../connectors/registry.ts';
import { createLogger } from '../lib/logger.ts';
import {
  InstallError,
  type Installed,
  installPlugin,
  listPlugins,
  removePlugin,
} from './install.ts';
import { defaultRegistry, SourceError } from './source.ts';

/** How the command reads and writes, replaced in tests. */
export interface CommandIo {
  /** Writes a line for the person. */
  readonly say: (line: string) => void;
  /** The environment, for the configuration. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The working directory, for local paths. */
  readonly workingDir: string;
  /** The fetch function. */
  readonly fetch: typeof fetch;
}

/** How to use the plugin commands. */
export const pluginUsage = [
  'querent plugin install <spec> [--registry <url>] [--max-bundle-mb <n>]',
  '  <spec>: an npm name with an optional version or range, an https:// tarball URL,',
  '          or a local .tgz or .js file',
  'querent plugin list',
  'querent plugin remove <name>',
].join('\n');

/** The largest bundle accepted by default, in megabytes. */
const defaultMaxBundleMb = 20;

/**
 * The value of an option, such as `--registry <url>`.
 *
 * @param args - The arguments.
 * @param name - The option, such as `--registry`.
 * @returns Its value, if given.
 */
function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * The configuration snippet that pins an installed plugin.
 *
 * @param installed - The plugin.
 * @returns The YAML lines.
 */
function pinSnippet(installed: Installed): string[] {
  return ['plugins:', '  pins:', `    "${installed.name}": "${installed.pin}"`];
}

/**
 * Prints what was installed and the pin to paste.
 *
 * @param installed - The plugin.
 * @param io - Output.
 */
function report(installed: Installed, io: CommandIo): void {
  io.say(`Installed ${installed.name} ${installed.version} into ${installed.folder}.`);
  io.say(`It adds the connector kinds: ${installed.kinds.join(', ')}.`);
  io.say('Pin it in the configuration file, then restart querent:');
  io.say('');
  for (const line of pinSnippet(installed)) io.say(line);
}

/**
 * Installs a plugin and prints its pin.
 *
 * @param args - The arguments after `install`.
 * @param io - Output, environment and fetch.
 * @returns The exit code.
 */
async function install(args: readonly string[], io: CommandIo): Promise<number> {
  const [spec] = args;
  const maxBundleMb = Number(option(args, '--max-bundle-mb') ?? defaultMaxBundleMb);
  if (spec === undefined || spec.startsWith('--') || !(maxBundleMb > 0)) {
    io.say(pluginUsage);
    return 2;
  }
  const config = loadConfig(io.environment, io.workingDir);
  try {
    report(
      await installPlugin(spec, {
        dir: config.pluginsDir,
        registry: option(args, '--registry') ?? defaultRegistry,
        maxBundleBytes: Math.floor(maxBundleMb * 1024 * 1024),
        workingDir: io.workingDir,
        fetch: io.fetch,
        offered: connectorKinds,
        logger: createLogger('error'),
      }),
      io,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof SourceError || error instanceof InstallError)) throw error;
    io.say(`Cannot install ${spec}: ${error.message}.`);
    return 1;
  }
}

/**
 * Lists the installed plugins and whether their pins match.
 *
 * @param io - Output and environment.
 * @returns The exit code.
 */
async function list(io: CommandIo): Promise<number> {
  const config = loadConfig(io.environment, io.workingDir);
  const plugins = await listPlugins(config.pluginsDir, config.pluginPins);
  io.say(`Plugins in ${config.pluginsDir}:`);
  if (plugins.length === 0) io.say('  none');
  for (const plugin of plugins)
    io.say(`  ${plugin.name ?? plugin.folder} ${plugin.version ?? ''}  ${plugin.state}`);
  return 0;
}

/**
 * Removes an installed plugin.
 *
 * @param name - Its package name.
 * @param io - Output and environment.
 * @returns The exit code.
 */
async function remove(name: string | undefined, io: CommandIo): Promise<number> {
  if (name === undefined) {
    io.say(pluginUsage);
    return 2;
  }
  const config = loadConfig(io.environment, io.workingDir);
  if (!(await removePlugin(config.pluginsDir, name))) {
    io.say(`${name} is not installed in ${config.pluginsDir}.`);
    return 1;
  }
  io.say(`Removed ${name}. Restart querent, and remove its pin from plugins.pins.`);
  return 0;
}

/**
 * Runs a plugin command.
 *
 * @param args - The arguments after `plugin`.
 * @param io - Output, environment and fetch.
 * @returns The exit code.
 */
export function runPluginCommand(args: readonly string[], io: CommandIo): Promise<number> {
  const [command, ...rest] = args;
  if (command === 'install') return install(rest, io);
  if (command === 'list') return list(io);
  if (command === 'remove') return remove(rest[0], io);
  io.say(pluginUsage);
  return Promise.resolve(2);
}
