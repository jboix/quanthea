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
    });
    expect(config.webDir).toEndWith('/apps/web/dist');
  });

  test('reads every variable', () => {
    const config = loadConfig(
      {
        QUERENT_PORT: '8080',
        QUERENT_DATA_DIR: '/data',
        QUERENT_AUTH_MODE: 'none',
        QUERENT_LOG_LEVEL: 'debug',
        QUERENT_WEB_DIR: 'public',
      },
      '/app',
    );
    expect(config).toEqual({
      port: 8080,
      dataDir: '/data',
      authModeOverride: 'none',
      logLevel: 'debug',
      webDir: '/app/public',
    });
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
