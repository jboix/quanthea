import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPluginCommand } from './command.ts';
import { tarball } from './test/tarball.ts';

/** A plugin bundle with one kind. */
function bundle(kind = 'events-file'): string {
  return `export const kitVersion = 0;
export default (kit) => ({ connectors: [kit.defineConnector({
  kind: '${kind}', displayName: 'Events file', language: 'sql', dialect: 'ansi',
  configSchema: kit.z.object({ file: kit.z.string() }), secretSchema: kit.z.object({}),
  open: () => { throw new kit.ConnectorError('unreachable', 'Not here.'); },
})] });
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
    name: options.name ?? 'quanthea-plugin-events',
    version,
    keywords: options.keywords ?? ['quanthea-plugin'],
    quanthea: { kitVersion: 0, main: 'dist/plugin.js' },
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
  root = mkdtempSync(join(tmpdir(), 'quanthea-cli-'));
  lines = [];
  tarballs = { '1.0.0': pack('1.0.0'), '1.2.0': pack('1.2.0'), '2.0.0': pack('2.0.0') };
  integrities = Object.fromEntries(
    Object.entries(tarballs).map(([version, tgz]) => [version, integrityOf(tgz)]),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The redirects the tarball host answers with, by URL. */
const redirects: Record<string, string> = {
  'https://files.test/latest.tgz': '/1.0.0.tgz',
  'https://files.test/downgrade.tgz': 'http://files.test/1.0.0.tgz',
  'https://files.test/loop.tgz': 'https://files.test/loop.tgz',
};

/** A registry and tarball host, answering as npm does, and never following a redirect itself. */
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url === 'https://registry.test/quanthea-plugin-events') {
    const versions = Object.fromEntries(
      Object.keys(tarballs).map((version) => [
        version,
        { dist: { tarball: `https://files.test/${version}.tgz`, integrity: integrities[version] } },
      ]),
    );
    return Response.json({ 'dist-tags': { latest: '1.2.0' }, versions });
  }
  const redirect = redirects[url];
  if (redirect) return new Response(null, { status: 302, headers: { Location: redirect } });
  const version = /files\.test\/(.*)\.tgz$/.exec(url)?.[1];
  const tgz = version ? tarballs[version] : undefined;
  return tgz ? new Response(tgz) : new Response('not found', { status: 404 });
}) as typeof fetch;

/**
 * Runs `quanthea plugin …` against the test directory.
 *
 * @param args - The arguments after `plugin`.
 * @param environment - More variables, such as a configuration file.
 * @returns The exit code.
 */
function run(args: string[], environment: Record<string, string> = {}): Promise<number> {
  return runPluginCommand(args, {
    say: (line) => lines.push(line),
    environment: { QUANTHEA_DATA_DIR: join(root, 'data'), ...environment },
    workingDir: root,
    fetch: fakeFetch,
  });
}

/** The plugins directory. */
const pluginsDir = () => join(root, 'data', 'plugins');

describe('quanthea plugin install', () => {
  test('resolves a range in the registry, checks integrity, and prints the pin to paste', async () => {
    expect(
      await run([
        'install',
        'quanthea-plugin-events@^1.0.0',
        '--registry',
        'https://registry.test',
      ]),
    ).toBe(0);
    expect(lines[0]).toBe(
      `Installed quanthea-plugin-events 1.2.0 into ${join(pluginsDir(), 'quanthea-plugin-events')}.`,
    );
    expect(lines.slice(4, 6)).toEqual(['plugins:', '  pins:']);
    const pin = /"(sha256:[0-9a-f]{64})"/.exec(lines[6] ?? '')?.[1];
    expect(pin).toBeDefined();
    expect(readdirSync(pluginsDir())).toEqual(['quanthea-plugin-events']);
    const config = join(root, 'quanthea.yaml');
    writeFileSync(config, `plugins:\n  pins:\n    quanthea-plugin-events: ${pin}\n`);
    lines = [];
    await run(['list'], { QUANTHEA_CONFIG: config });
    expect(lines[1]).toBe('  quanthea-plugin-events 1.2.0  pinned');
  });

  test('installs the latest without a range, and an upgrade replaces the folder', async () => {
    await run(['install', 'quanthea-plugin-events', '--registry', 'https://registry.test']);
    await run(['install', 'quanthea-plugin-events@2', '--registry', 'https://registry.test']);
    expect(
      lines.filter((line) => line.startsWith('Installed')).map((line) => line.split(' ')[2]),
    ).toEqual(['1.2.0', '2.0.0']);
    expect(readdirSync(pluginsDir())).toEqual(['quanthea-plugin-events']);
  });

  test('refuses a tarball that does not match its integrity, leaving nothing behind', async () => {
    integrities['1.2.0'] = integrityOf(pack('9.9.9'));
    expect(
      await run(['install', 'quanthea-plugin-events', '--registry', 'https://registry.test']),
    ).toBe(1);
    expect(lines[0]).toBe(
      'Cannot install quanthea-plugin-events: the tarball does not match the integrity the registry gives.',
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
      'Cannot install keyword.tgz: package.json lacks the quanthea-plugin keyword.',
      'Cannot install size.tgz: the bundle is larger than 104 bytes.',
    ]);
    expect(readdirSync(pluginsDir())).toEqual([]);
  });

  test('installs from https, a local .tgz and a local .js bundle, but never http', async () => {
    expect(await run(['install', 'https://files.test/1.0.0.tgz'])).toBe(0);
    writeFileSync(join(root, 'local.tgz'), pack('1.0.0', { name: '@acme/quanthea-plugin-local' }));
    expect(await run(['install', 'local.tgz'])).toBe(0);
    const folder = mkdtempSync(join(root, 'repo-'));
    writeFileSync(
      join(folder, 'package.json'),
      JSON.stringify({
        name: 'quanthea-plugin-dev',
        version: '0.0.1',
        keywords: ['quanthea-plugin'],
        quanthea: { kitVersion: 0, main: 'plugin.js' },
      }),
    );
    writeFileSync(join(folder, 'plugin.js'), bundle('dev-file'));
    expect(await run(['install', join(folder, 'plugin.js')])).toBe(0);
    expect(readdirSync(pluginsDir()).sort()).toEqual([
      'acme__quanthea-plugin-local',
      'quanthea-plugin-dev',
      'quanthea-plugin-events',
    ]);
    expect(await run(['install', 'http://files.test/1.0.0.tgz'])).toBe(1);
  });

  test('removes a plugin by name', async () => {
    await run(['install', 'https://files.test/1.0.0.tgz']);
    expect(await run(['remove', 'quanthea-plugin-events'])).toBe(0);
    expect(readdirSync(pluginsDir())).toEqual([]);
    expect(await run(['remove', 'quanthea-plugin-events'])).toBe(1);
  });

  test('follows a redirect only to https, and only a few times', async () => {
    expect(await run(['install', 'https://files.test/latest.tgz'])).toBe(0);
    expect(await run(['install', 'https://files.test/downgrade.tgz'])).toBe(1);
    expect(await run(['install', 'https://files.test/loop.tgz'])).toBe(1);
    expect(lines.slice(-2)).toEqual([
      'Cannot install https://files.test/downgrade.tgz: only https:// is fetched: http://files.test/1.0.0.tgz.',
      'Cannot install https://files.test/loop.tgz: https://files.test/loop.tgz redirects more than 5 times.',
    ]);
  });

  test('checks a tarball URL against --integrity when given', async () => {
    const url = 'https://files.test/1.0.0.tgz';
    expect(await run(['install', url, '--integrity', integrities['1.0.0'] ?? ''])).toBe(0);
    lines = [];
    expect(await run(['install', url, '--integrity', integrities['2.0.0'] ?? ''])).toBe(1);
    expect(await run(['install', url, '--integrity', 'sha1-abc'])).toBe(1);
    expect(await run(['install', 'quanthea-plugin-events', '--integrity', 'sha512-x'])).toBe(1);
    expect(lines).toEqual([
      `Cannot install ${url}: the tarball does not match the integrity --integrity gives.`,
      `Cannot install ${url}: --integrity gives no sha512 integrity for the tarball.`,
      'Cannot install quanthea-plugin-events: --integrity applies only to an https:// tarball URL.',
    ]);
  });
});
