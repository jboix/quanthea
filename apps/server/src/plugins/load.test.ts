import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postgresConnector } from '../connectors/postgres/postgres-connector.ts';
import { createLogger } from '../lib/logger.ts';
import { loadPlugins, missingPinned } from './load.ts';
import { folderOf, pinOf } from './pin.ts';

/** A plugin module, as a bundle: one kind, built with the kit it receives. */
function source(kind = 'events-file', kitVersion = 1, body = ''): string {
  return `export const kitVersion = ${kitVersion};
export default function plugin(kit) {
  ${body}
  return [kit.defineConnector({
    kind: '${kind}',
    displayName: 'Events file',
    language: 'sql',
    dialect: 'ansi',
    placeholders: '?',
    rowLimit: 'limit',
    configSchema: kit.z.object({ file: kit.z.string() }),
    secretSchema: kit.z.object({}),
    open: () => { throw new kit.ConnectorError('unreachable', 'Not in this test.'); },
  })];
}
`;
}

let dir: string;
let lines: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'querent-plugins-'));
  lines = [];
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Installs a plugin folder as the installer would leave it.
 *
 * @param name - The package name.
 * @param bundle - The bundle's text.
 * @param kitVersion - The manifest's kit version.
 * @returns The plugin's pin.
 */
function install(name: string, bundle: string, kitVersion = 1): string {
  const folder = join(dir, folderOf(name));
  mkdirSync(folder);
  const manifest = JSON.stringify({
    name,
    version: '1.2.0',
    keywords: ['querent-plugin'],
    querent: { kitVersion, main: 'dist/plugin.js' },
  });
  writeFileSync(join(folder, 'package.json'), manifest);
  writeFileSync(join(folder, 'plugin.js'), bundle);
  return pinOf(new TextEncoder().encode(manifest), new TextEncoder().encode(bundle));
}

/**
 * Loads the directory.
 *
 * @param pins - The pins.
 * @param allowUnpinned - Whether unpinned plugins load.
 * @returns The kinds the plugins add.
 */
function load(pins: Record<string, string>, allowUnpinned = false) {
  const logger = createLogger(
    'debug',
    { stdout: (line) => lines.push(line), stderr: (line) => lines.push(line) },
    'json',
  );
  return loadPlugins({ dir, pins, allowUnpinned, offered: [postgresConnector], logger });
}

/**
 * The reason a plugin was refused, from the log.
 *
 * @returns The reasons, in order.
 */
function refusals(): string[] {
  return lines
    .map((line) => JSON.parse(line) as { message?: string; msg?: string; reason?: string })
    .filter((entry) => (entry.message ?? entry.msg) === 'plugin refused')
    .map((entry) => entry.reason ?? '');
}

describe('loadPlugins', () => {
  test('loads a pinned plugin, its kinds marked with their origin', async () => {
    const pin = install('querent-plugin-events', source());
    const [kind] = await load({ 'querent-plugin-events': pin });
    expect(kind?.kind).toBe('events-file');
    expect(kind?.plugin).toEqual({ name: 'querent-plugin-events', version: '1.2.0' });
    expect(Object.isFrozen(kind)).toBe(true);
    expect(lines.some((line) => line.includes('plugin loaded'))).toBe(true);
  });

  test('refuses a plugin whose files changed since its pin, saying how to fix it', async () => {
    const pin = install('@acme/querent-plugin-events', source());
    writeFileSync(join(dir, 'acme__querent-plugin-events', 'plugin.js'), source('other-kind'));
    expect(await load({ '@acme/querent-plugin-events': pin })).toEqual([]);
    expect(refusals()[0]).toStartWith('pin mismatch: paste the snippet `querent plugin install`');
  });

  test('refuses an unpinned plugin unless unpinned plugins are allowed', async () => {
    install('querent-plugin-events', source());
    expect(await load({})).toEqual([]);
    expect(refusals()[0]).toStartWith('not pinned');
    expect(await load({}, true)).toHaveLength(1);
    expect(lines.some((line) => line.includes('plugin loaded without a pin'))).toBe(true);
  });

  test('refuses a kind offered already, by a built-in or an earlier plugin', async () => {
    const pins = {
      'querent-plugin-a': install('querent-plugin-a', source('events-file')),
      'querent-plugin-b': install('querent-plugin-b', source('events-file')),
      'querent-plugin-c': install('querent-plugin-c', source('postgres')),
    };
    expect((await load(pins)).map((kind) => kind.plugin?.name)).toEqual(['querent-plugin-a']);
    expect(refusals()).toEqual([
      'the kind "events-file" is offered already',
      'the kind "postgres" is offered already',
    ]);
  });

  test('refuses an unsupported kit version, and a module that disagrees with its manifest', async () => {
    const pins = {
      'querent-plugin-a': install('querent-plugin-a', source('a-kind', 2), 2),
      'querent-plugin-b': install('querent-plugin-b', source('b-kind', 2)),
    };
    expect(await load(pins)).toEqual([]);
    expect(refusals()).toEqual([
      'kit version 2 is not supported: this server loads 1',
      'the module and package.json name different kit versions',
    ]);
  });

  test('refuses a plugin that throws, or whose kinds fail the static checks', async () => {
    const pins = {
      'querent-plugin-a': install(
        'querent-plugin-a',
        source('a-kind', 1, 'throw new Error("boom");'),
      ),
      'querent-plugin-b': install(
        'querent-plugin-b',
        'export const kitVersion = 1;\nexport default () => [{ kind: "b-kind", language: "sql" }];',
      ),
      'querent-plugin-c': install('querent-plugin-c', 'export const kitVersion = 1;'),
    };
    expect(await load(pins)).toEqual([]);
    const [thrown, failed, empty] = refusals();
    expect(thrown).toBe('it failed to load: boom');
    expect(failed).toStartWith('a kind fails the static checks: displayName must be a name');
    expect(empty).toBe('the module exports no plugin function as default');
  });

  test('names pinned plugins that are not installed', async () => {
    const pin = install('querent-plugin-a', source());
    const loaded = await load({ 'querent-plugin-a': pin, 'querent-plugin-gone': pin });
    expect(missingPinned({ 'querent-plugin-a': pin, 'querent-plugin-gone': pin }, loaded)).toEqual([
      'querent-plugin-gone',
    ]);
  });
});
