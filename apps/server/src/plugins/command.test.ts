import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPluginCommand } from './command.ts';
import { tarball } from './test/tarball.ts';

/** A plugin bundle with one kind. */
function bundle(kind = 'events-file'): string {
  return `export const kitVersion = 1;
export default (kit) => [kit.defineConnector({
  kind: '${kind}', displayName: 'Events file', language: 'sql', dialect: 'ansi',
  configSchema: kit.z.object({ file: kit.z.string() }), secretSchema: kit.z.object({}),
  open: () => { throw new kit.ConnectorError('unreachable', 'Not here.'); },
})];
`;
}

/**
 * A plugin's npm tarball.
 *
 * @param version - Its version.
 * @param options - The kind, the keywords, the package name.
 * @returns The `.tgz` bytes.
 */
function pack(
  version: string,
  options: { kind?: string; keywords?: string[]; name?: string } = {},
): Uint8Array {
  const manifest = {
    name: options.name ?? 'querent-plugin-events',
    version,
    keywords: options.keywords ?? ['querent-plugin'],
    querent: { kitVersion: 1, main: 'dist/plugin.js' },
  };
  return tarball([
    { path: 'package/package.json', data: JSON.stringify(manifest) },
    { path: 'package/dist/plugin.js', data: bundle(options.kind) },
  ]);
}

/**
 * The npm integrity of a tarball.
 *
 * @param tgz - The tarball.
 * @returns Such as `sha512-…`.
 */
function integrityOf(tgz: Uint8Array): string {
  return `sha512-${new Bun.CryptoHasher('sha512').update(tgz).digest('base64')}`;
}

let root: string;
let lines: string[];
let tarballs: Record<string, Uint8Array>;
let integrities: Record<string, string>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'querent-cli-'));
  lines = [];
  tarballs = { '1.0.0': pack('1.0.0'), '1.2.0': pack('1.2.0'), '2.0.0': pack('2.0.0') };
  integrities = Object.fromEntries(
    Object.entries(tarballs).map(([version, tgz]) => [version, integrityOf(tgz)]),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A registry and tarball host, answering as npm does. */
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url === 'https://registry.test/querent-plugin-events') {
    const versions = Object.fromEntries(
      Object.keys(tarballs).map((version) => [
        version,
        { dist: { tarball: `https://files.test/${version}.tgz`, integrity: integrities[version] } },
      ]),
    );
    return Response.json({ 'dist-tags': { latest: '1.2.0' }, versions });
  }
  const version = /files\.test\/(.*)\.tgz$/.exec(url)?.[1];
  const tgz = version ? tarballs[version] : undefined;
  return tgz ? new Response(tgz) : new Response('not found', { status: 404 });
}) as typeof fetch;

/**
 * Runs `querent plugin …` against the test directory.
 *
 * @param args - The arguments after `plugin`.
 * @param environment - More variables, such as a configuration file.
 * @returns The exit code.
 */
function run(args: string[], environment: Record<string, string> = {}): Promise<number> {
  return runPluginCommand(args, {
    say: (line) => lines.push(line),
    environment: { QUERENT_DATA_DIR: join(root, 'data'), ...environment },
    workingDir: root,
    fetch: fakeFetch,
  });
}

/** The plugins directory. */
const pluginsDir = () => join(root, 'data', 'plugins');

describe('querent plugin install', () => {
  test('resolves a range in the registry, checks integrity, and prints the pin to paste', async () => {
    expect(
      await run(['install', 'querent-plugin-events@^1.0.0', '--registry', 'https://registry.test']),
    ).toBe(0);
    expect(lines[0]).toBe(
      `Installed querent-plugin-events 1.2.0 into ${join(pluginsDir(), 'querent-plugin-events')}.`,
    );
    expect(lines.slice(4, 6)).toEqual(['plugins:', '  pins:']);
    const pin = /"(sha256:[0-9a-f]{64})"/.exec(lines[6] ?? '')?.[1];
    expect(pin).toBeDefined();
    expect(readdirSync(pluginsDir())).toEqual(['querent-plugin-events']);
    const config = join(root, 'querent.yaml');
    writeFileSync(config, `plugins:\n  pins:\n    querent-plugin-events: ${pin}\n`);
    lines = [];
    await run(['list'], { QUERENT_CONFIG: config });
    expect(lines[1]).toBe('  querent-plugin-events 1.2.0  pinned');
  });

  test('installs the latest without a range, and an upgrade replaces the folder', async () => {
    await run(['install', 'querent-plugin-events', '--registry', 'https://registry.test']);
    await run(['install', 'querent-plugin-events@2', '--registry', 'https://registry.test']);
    expect(
      lines.filter((line) => line.startsWith('Installed')).map((line) => line.split(' ')[2]),
    ).toEqual(['1.2.0', '2.0.0']);
    expect(readdirSync(pluginsDir())).toEqual(['querent-plugin-events']);
  });

  test('refuses a tarball that does not match its integrity, leaving nothing behind', async () => {
    integrities['1.2.0'] = integrityOf(pack('9.9.9'));
    expect(
      await run(['install', 'querent-plugin-events', '--registry', 'https://registry.test']),
    ).toBe(1);
    expect(lines[0]).toBe(
      'Cannot install querent-plugin-events: the tarball does not match the integrity the registry gives.',
    );
    expect(existsSync(pluginsDir())).toBe(false);
  });

  test('refuses a plugin that fails the checks, clashes, lacks the keyword or is too large', async () => {
    const cases: [string, Uint8Array, string[]][] = [
      ['clash', pack('1.0.0', { kind: 'postgres' }), []],
      ['keyword', pack('1.0.0', { keywords: [] }), []],
      ['size', pack('1.0.0'), ['--max-bundle-mb', '0.0001']],
    ];
    for (const [name, tgz, extra] of cases) {
      writeFileSync(join(root, `${name}.tgz`), tgz);
      expect(await run(['install', `${name}.tgz`, ...extra])).toBe(1);
    }
    expect(lines).toEqual([
      'Cannot install clash.tgz: the kind "postgres" is offered already.',
      'Cannot install keyword.tgz: package.json lacks the querent-plugin keyword.',
      'Cannot install size.tgz: the bundle is larger than 104 bytes.',
    ]);
    expect(readdirSync(pluginsDir())).toEqual([]);
  });

  test('installs from https, a local .tgz and a local .js bundle, but never http', async () => {
    expect(await run(['install', 'https://files.test/1.0.0.tgz'])).toBe(0);
    writeFileSync(join(root, 'local.tgz'), pack('1.0.0', { name: '@acme/querent-plugin-local' }));
    expect(await run(['install', 'local.tgz'])).toBe(0);
    const folder = mkdtempSync(join(root, 'repo-'));
    writeFileSync(
      join(folder, 'package.json'),
      JSON.stringify({
        name: 'querent-plugin-dev',
        version: '0.0.1',
        keywords: ['querent-plugin'],
        querent: { kitVersion: 1, main: 'plugin.js' },
      }),
    );
    writeFileSync(join(folder, 'plugin.js'), bundle('dev-file'));
    expect(await run(['install', join(folder, 'plugin.js')])).toBe(0);
    expect(readdirSync(pluginsDir()).sort()).toEqual([
      'acme__querent-plugin-local',
      'querent-plugin-dev',
      'querent-plugin-events',
    ]);
    expect(await run(['install', 'http://files.test/1.0.0.tgz'])).toBe(1);
  });

  test('removes a plugin by name', async () => {
    await run(['install', 'https://files.test/1.0.0.tgz']);
    expect(await run(['remove', 'querent-plugin-events'])).toBe(0);
    expect(readdirSync(pluginsDir())).toEqual([]);
    expect(await run(['remove', 'querent-plugin-events'])).toBe(1);
  });
});
