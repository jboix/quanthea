import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDir } from '../test/fixtures.ts';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  test('applies the defaults and resolves paths against the working directory', () => {
    const config = loadConfig({}, '/srv/querent');
    expect(config).toMatchObject({
      port: 3000,
      dataDir: '/srv/querent/data',
      keysDir: '/srv/querent/keys',
      logLevel: 'info',
      logFormat: 'text',
    });
    expect(config.webDir).toEndWith('/apps/web/dist');
  });

  test('reads every variable', () => {
    const config = loadConfig(
      {
        QUERENT_PORT: '8080',
        QUERENT_DATA_DIR: '/data',
        QUERENT_KEYS_DIR: '/keys',
        QUERENT_LOG_LEVEL: 'debug',
        QUERENT_LOG_FORMAT: 'json',
        QUERENT_WEB_DIR: 'public',
        QUERENT_SECRET_KEY: 'a2V5',
        QUERENT_SESSION_KEY_FILE: 'keys/session',
        QUERENT_PUBLIC_URL: 'https://querent.example.com/',
        QUERENT_TRUSTED_PROXY_HOPS: '1',
      },
      '/app',
    );
    expect(config).toMatchObject({
      port: 8080,
      dataDir: '/data',
      keysDir: '/keys',
      logLevel: 'debug',
      logFormat: 'json',
      webDir: '/app/public',
      publicUrl: 'https://querent.example.com',
      trustedProxyHops: 1,
    });
    expect(config.keys.secret).toEqual({
      name: 'QUERENT_SECRET_KEY',
      value: 'a2V5',
      file: undefined,
    });
    expect(config.keys.session).toEqual({
      name: 'QUERENT_SESSION_KEY',
      value: undefined,
      file: '/app/keys/session',
    });
  });

  test('takes an https public URL, or http on this machine, as an origin only', () => {
    const url = (value: string) => loadConfig({ QUERENT_PUBLIC_URL: value }).publicUrl;
    expect(url('http://localhost:5173')).toBe('http://localhost:5173');
    expect(() => url('http://querent.example.com')).toThrow('Use https://');
    expect(() => url('https://querent.example.com/app')).toThrow('origin only');
    expect(() => url('https://user:pass@querent.example.com')).toThrow('origin only');
  });

  test('treats an empty variable as unset', () => {
    expect(loadConfig({ QUERENT_LOG_LEVEL: '', QUERENT_PORT: '' }, '/app')).toMatchObject({
      logLevel: 'info',
      port: 3000,
    });
  });

  test('names every invalid variable', () => {
    const failure = () => loadConfig({ QUERENT_PORT: 'eighty', QUERENT_LOG_LEVEL: 'loud' });
    expect(failure).toThrow(/QUERENT_PORT/);
    expect(failure).toThrow(/QUERENT_LOG_LEVEL/);
  });
});

describe('the configuration file', () => {
  let directory: ReturnType<typeof temporaryDir>;

  beforeEach(() => {
    directory = temporaryDir();
  });

  afterEach(() => directory.remove());

  /**
   * Writes a file into the test directory.
   *
   * @param name - The file name.
   * @param text - Its content.
   * @returns Its path.
   */
  function write(name: string, text: string): string {
    const path = join(directory.path, name);
    writeFileSync(path, text);
    return path;
  }

  test('sets what no variable sets, and says where each value comes from', () => {
    const path = write(
      'querent.yaml',
      'server:\n  publicUrl: https://querent.example.com\n  port: 8080\n  keysDir: /keys\n',
    );
    const config = loadConfig({ QUERENT_CONFIG: path, QUERENT_PORT: '9090' }, '/app');
    expect(config).toMatchObject({
      publicUrl: 'https://querent.example.com',
      port: 9090,
      keysDir: '/keys',
      configFiles: [path],
    });
    expect(config.sources.publicUrl).toEqual({ kind: 'file', path });
    expect(config.sources.port).toEqual({ kind: 'environment', variable: 'QUERENT_PORT' });
    expect(config.sources.logLevel).toEqual({ kind: 'default' });
  });

  test('reads the plugins section: the directory, unpinned plugins and the pins', () => {
    const pin = `sha256:${'a'.repeat(64)}`;
    const path = write(
      'querent.yaml',
      `plugins:\n  dir: ./plugins\n  allowUnpinned: true\n  pins:\n    "@acme/querent-plugin-sqlite": ${pin}\n`,
    );
    const config = loadConfig({ QUERENT_CONFIG: path }, '/app');
    expect(config).toMatchObject({
      pluginsDir: '/app/plugins',
      pluginsAllowUnpinned: true,
      pluginPins: { '@acme/querent-plugin-sqlite': pin },
    });
    expect(config.sources.pluginsDir).toEqual({ kind: 'file', path });
    const overridden = loadConfig(
      {
        QUERENT_CONFIG: path,
        QUERENT_PLUGINS_DIR: '/plugins',
        QUERENT_PLUGINS_ALLOW_UNPINNED: 'false',
      },
      '/app',
    );
    expect(overridden).toMatchObject({ pluginsDir: '/plugins', pluginsAllowUnpinned: false });
  });

  test('keeps plugins in the data directory, pinned, by default', () => {
    expect(loadConfig({ QUERENT_DATA_DIR: '/srv/data' })).toMatchObject({
      pluginsDir: '/srv/data/plugins',
      pluginsAllowUnpinned: false,
      pluginPins: {},
    });
  });

  test('refuses a malformed pin, a name that is not a plugin and an unknown key', () => {
    const path = write(
      'querent.yaml',
      'plugins:\n  pinned: true\n  pins:\n    querent-plugin-a: abc\n    lodash: sha256:00\n',
    );
    expect(() => loadConfig({ QUERENT_CONFIG: path })).toThrow(
      /plugins.pinned .* is not a setting[\s\S]*Paste the pin querent plugin install printed[\s\S]*querent-plugin-<name>/,
    );
  });

  test('reads a directory of YAML and JSON files in name order, a key in one file only', () => {
    write('10-server.yaml', 'server:\n  port: 8080\n');
    write('20-proxy.json', '{ "server": { "trustedProxyHops": 1 } }');
    write('notes.txt', 'ignored');
    const config = loadConfig({ QUERENT_CONFIG: directory.path });
    expect(config).toMatchObject({ port: 8080, trustedProxyHops: 1 });
    expect(config.configFiles).toHaveLength(2);
    write('30-again.yml', 'server:\n  port: 9090\n');
    expect(() => loadConfig({ QUERENT_CONFIG: directory.path })).toThrow(
      /server\.port` is set in both/,
    );
  });

  test('replaces a variable reference, keeps an escaped one as text, and names unset ones', () => {
    // Built from parts: a reference is a dollar sign, then the name in braces.
    const reference = (name: string) => ['$', '{', name, '}'].join('');
    const path = write('querent.yaml', `server:\n  publicUrl: https://${reference('HOST')}\n`);
    expect(loadConfig({ QUERENT_CONFIG: path, HOST: 'q.example.com' }).publicUrl).toBe(
      'https://q.example.com',
    );
    expect(() => loadConfig({ QUERENT_CONFIG: path })).toThrow('unset variables: HOST');
    write('querent.yaml', `server:\n  webDir: ./$${reference('HOME')}\n`);
    expect(loadConfig({ QUERENT_CONFIG: path, HOME: '/root' }, '/app').webDir).toBe(
      `/app/${reference('HOME')}`,
    );
  });

  test('refuses a missing path, an unknown section or setting, and an invalid value', () => {
    expect(() => loadConfig({ QUERENT_CONFIG: join(directory.path, 'none.yaml') })).toThrow(
      'does not exist',
    );
    const path = write('querent.yaml', 'servr:\n  port: 1\n');
    expect(() => loadConfig({ QUERENT_CONFIG: path })).toThrow('unknown section `servr`');
    write('querent.yaml', 'server:\n  prot: 1\n  publicUrl: http://querent.example.com\n');
    const failure = () => loadConfig({ QUERENT_CONFIG: path });
    expect(failure).toThrow('server.prot in');
    expect(failure).toThrow(/server\.publicUrl in .*: Use https/);
  });
});
