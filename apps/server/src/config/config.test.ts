import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  test('applies the defaults and resolves paths against the working directory', () => {
    const config = loadConfig({}, '/srv/querent');
    expect(config).toMatchObject({
      port: 3000,
      dataDir: '/srv/querent/data',
      authModeOverride: undefined,
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
        QUERENT_AUTH_MODE: 'accounts',
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
      authModeOverride: 'accounts',
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
    expect(loadConfig({ QUERENT_AUTH_MODE: '', QUERENT_PORT: '' }, '/app')).toMatchObject({
      authModeOverride: undefined,
      port: 3000,
    });
  });

  test('names every invalid variable', () => {
    expect(() => loadConfig({ QUERENT_PORT: 'eighty', QUERENT_AUTH_MODE: 'keycloak' })).toThrow(
      /QUERENT_PORT[\s\S]*QUERENT_AUTH_MODE/,
    );
  });
});
