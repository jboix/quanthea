import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDir } from '../test/fixtures.ts';
import { loadConfig } from './config.ts';
import { serverSettingsView } from './server-view.ts';

let directory: ReturnType<typeof temporaryDir>;

beforeEach(() => {
  directory = temporaryDir();
});

afterEach(() => directory.remove());

describe('Settings → Server', () => {
  test('shows each setting with its source, and each key by where it comes from only', () => {
    const path = join(directory.path, 'quanthea.yaml');
    writeFileSync(path, 'server:\n  publicUrl: https://quanthea.example.com\n');
    const secretKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    const environment = {
      QUANTHEA_CONFIG: path,
      QUANTHEA_PORT: '8080',
      QUANTHEA_SECRET_KEY: secretKey,
    };
    const config = loadConfig(environment, '/app');
    const view = serverSettingsView(config, {
      secret: { kind: 'variable', variable: 'QUANTHEA_SECRET_KEY' },
      session: {
        kind: 'file',
        variable: 'QUANTHEA_SESSION_KEY_FILE',
        path: '/run/secrets/session',
      },
      pepper: { kind: 'generated', path: '/app/keys/password-pepper.key' },
    });
    expect(view.configFiles).toEqual([path]);
    const byKey = Object.fromEntries(view.settings.map((setting) => [setting.key, setting]));
    expect(byKey.publicUrl).toMatchObject({
      value: 'https://quanthea.example.com',
      source: { kind: 'file', path },
      variable: 'QUANTHEA_PUBLIC_URL',
    });
    expect(byKey.port).toMatchObject({ value: '8080', source: { kind: 'environment' } });
    expect(byKey.logLevel).toMatchObject({ value: 'info', source: { kind: 'default' } });
    expect(view.keys).toEqual([
      {
        label: 'Secret key',
        source: { kind: 'environment', variable: 'QUANTHEA_SECRET_KEY' },
        file: null,
      },
      {
        label: 'Session key',
        source: { kind: 'environment', variable: 'QUANTHEA_SESSION_KEY_FILE' },
        file: '/run/secrets/session',
      },
      {
        label: 'Password pepper',
        source: { kind: 'generated', path: '/app/keys/password-pepper.key' },
        file: null,
      },
    ]);
    expect(JSON.stringify(view)).not.toContain(secretKey);
  });
});
