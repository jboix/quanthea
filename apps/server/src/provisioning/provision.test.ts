import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readConfigFile } from '../config/config-file.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createProvisionedRepository } from '../db/provisioned-repository.ts';
import { keyedHash } from '../secrets/keyed-hash.ts';
import { captureLogs, temporaryDir, testServices } from '../test/fixtures.ts';
import { provision } from './provision.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let configDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let path: string;

beforeEach(async () => {
  dataDir = temporaryDir();
  configDir = temporaryDir();
  services = await testServices(dataDir.path);
  path = join(configDir.path, 'querent.yaml');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
  configDir.remove();
});

/** A variable reference, built from parts so no literal holds one. */
const reference = (name: string) => ['$', '{', name, '}'].join('');

/**
 * A memory connector as the file declares it.
 *
 * @param extra - More lines, indented under the connector.
 * @param secret - How the secret is written.
 * @returns The YAML.
 */
function connector(extra = '', secret = reference('EVENTS_TOKEN')): string {
  return `  events:\n    kind: memory\n    config: { rowCount: 5 }\n    secret: { token: "${secret}" }\n${extra}`;
}

/**
 * Writes the file and applies it.
 *
 * @param yaml - The file's content.
 * @param environment - The environment variables.
 * @returns Once it is applied.
 */
async function apply(yaml: string, environment: Record<string, string> = {}): Promise<void> {
  writeFileSync(path, yaml);
  const file = readConfigFile(path, { EVENTS_TOKEN: 'token-from-env-9f2a', ...environment });
  await provision({
    file,
    repository: createProvisionedRepository(services.database),
    fingerprints: await keyedHash(new Uint8Array(32).fill(7), 'test'),
    emailIndex: services.hashes.emailIndex,
    peppers: services.hashes.peppers,
    services,
    audit: createAuditRepository(services.database),
    logger: captureLogs().logger,
  });
}

/**
 * The connector named `events`, if any.
 *
 * @returns Its summary.
 */
function events() {
  return services.connections.list().find((each) => each.name === 'events');
}

/**
 * The actors of the audit log.
 *
 * @returns Each entry's actor and action.
 */
function auditTrail() {
  return services.database
    .query<{ actor: string; action: string }, []>('SELECT actor, action FROM audit_log ORDER BY at')
    .all();
}

describe('provisioning connectors', () => {
  test('creates a connector with its secret from a variable, then leaves it alone', async () => {
    await apply(`connectors:\n${connector()}`);
    const created = events();
    expect(created).toMatchObject({ kind: 'memory', accessLevel: 2 });
    expect(services.managed.pathOf('connector', 'events')).toBe(path);
    const detail = await services.connections.get(created?.id ?? '');
    expect(detail.secret.token).toBe('••••••••9f2a');
    expect(auditTrail()).toContainEqual({ actor: 'provisioning', action: 'connector.create' });
    await apply(`connectors:\n${connector()}`);
    expect(events()?.updatedAt).toBe(created?.updatedAt);
  });

  test('applies a changed secret, and reads one from a file', async () => {
    await apply(`connectors:\n${connector()}`);
    const secretFile = join(configDir.path, 'token');
    writeFileSync(secretFile, 'token-from-file-77aa\n');
    await apply(`connectors:\n${connector('', `file:${secretFile}`)}`);
    const detail = await services.connections.get(events()?.id ?? '');
    expect(detail.secret.token).toBe('••••••••77aa');
  });

  test('refuses a secret in clear, an unknown field or a bad name, and applies nothing', async () => {
    const clear = apply(`connectors:\n${connector('', 'plain-text-secret-value')}`);
    await expect(clear).rejects.toThrow('connectors.events.secret.token holds a secret in clear');
    await expect(clear).rejects.not.toThrow('plain-text-secret-value');
    const unquoted = `connectors:\n  events:\n    kind: memory\n    config: {}\n    secret: { token: ${reference('EVENTS_TOKEN')} }\n`;
    await expect(apply(unquoted)).rejects.toThrow('put the variable reference in quotes');
    await expect(apply(`connectors:\n${connector('    acessLevel: 3\n')}`)).rejects.toThrow(
      'acessLevel',
    );
    await expect(
      apply(`connectors:\n  "Bad Name":\n    kind: memory\n    config: {}\n`),
    ).rejects.toThrow('connectors.Bad Name');
    expect(events()).toBeUndefined();
  });

  test('takes over a connector made in the interface, and refuses to change its kind', async () => {
    await services.connections.create(
      {
        name: 'events',
        kind: 'memory',
        config: { rowCount: 1 },
        secret: { token: 'typed-in-the-interface-01' },
        accessLevel: 1,
        hiddenFields: [],
        guardrails: { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 },
        descriptions: {},
      },
      'admin-1',
    );
    await apply(`connectors:\n${connector('    accessLevel: 3\n')}`);
    expect(events()?.accessLevel).toBe(3);
    const other = `connectors:\n  events:\n    kind: postgres\n    config: {}\n`;
    await expect(apply(other)).rejects.toThrow('a kind never changes');
  });

  test('releases what the file no longer declares, or deletes it with prune', async () => {
    await apply(`connectors:\n${connector()}`);
    await apply('server:\n  port: 3000\n');
    expect(events()).toBeDefined();
    expect(services.managed.pathOf('connector', 'events')).toBeUndefined();
    await apply(`connectors:\n${connector()}`);
    await apply('provisioning:\n  prune: true\n');
    expect(events()).toBeUndefined();
  });

  test('leaves descriptions to the interface unless the file declares them', async () => {
    await apply(`connectors:\n${connector()}`);
    expect(() =>
      services.managed.refuseChange('connector', 'events', ['descriptions']),
    ).not.toThrow();
    expect(() => services.managed.refuseChange('connector', 'events', ['accessLevel'])).toThrow(
      `${path} manages this`,
    );
    await apply(`connectors:\n${connector('    descriptions: { events: Every order event }\n')}`);
    expect(() => services.managed.refuseChange('connector', 'events', ['descriptions'])).toThrow();
  });
});

describe('provisioning settings sections', () => {
  /** A model section with one provider, its key written as given. */
  const model = (apiKey: string) =>
    [
      'model:',
      '  defaultProviderId: mistral',
      '  providers:',
      '    - id: mistral',
      '      name: Mistral',
      '      provider: mistral',
      '      baseUrl: null',
      '      models: { build: mistral-large-latest, plan: "", repair: "", metadata: "" }',
      `      apiKey: "${apiKey}"`,
      '',
    ].join('\n');

  test('saves the model gateway with its key from a variable, and manages it whole', async () => {
    await apply(model(reference('MISTRAL_KEY')), { MISTRAL_KEY: 'mistral-key-from-env-5c3d' });
    expect(services.modelSettings.gateway().defaultProviderId).toBe('mistral');
    expect((await services.modelSettings.resolve('mistral')).apiKey).toBe(
      'mistral-key-from-env-5c3d',
    );
    expect(services.managed.pathsOf('settings')).toEqual({ model: path });
    expect(() => services.managed.refuseChange('settings', 'model')).toThrow('manages this');
  });

  test('refuses a model key in clear, and an invalid section', async () => {
    const clear = apply(model('sk-in-clear-0000'));
    await expect(clear).rejects.toThrow('model.providers.0.apiKey holds a secret in clear');
    await expect(clear).rejects.not.toThrow('sk-in-clear-0000');
    await expect(apply('retention:\n  binDays: -1\n')).rejects.toThrow('retention.binDays');
  });

  test('saves retention, charts and queries, and releases them when left out', async () => {
    await apply('retention:\n  binDays: 7\ncharts:\n  disabled: [radar]\n');
    expect(services.retention.get().binDays).toBe(7);
    expect(services.chartSettings.get().disabled).toEqual(['radar']);
    await apply('queries:\n  disabled: []\n');
    expect(services.managed.pathsOf('settings')).toEqual({ queries: path });
    expect(services.retention.get().binDays).toBe(7);
  });
});

describe('provisioning users and sign-in', () => {
  const strong = 'violet harbour lantern 5e1b';

  test('creates an admin with a first password, and never records their email', async () => {
    const yaml = `users:\n  ada@example.com: { name: Ada Lovelace, role: admin, password: "${reference('ADMIN_PASSWORD')}" }\n`;
    await apply(yaml, { ADMIN_PASSWORD: strong });
    const row = await services.users.findByEmail('ada@example.com');
    expect(row).toMatchObject({ role: 'admin' });
    expect(row?.passwordHash).toStartWith('$argon2id$');
    expect(await services.managed.userPathOf('ADA@example.com')).toBe(path);
    const names = services.database
      .query<{ name: string }, []>("SELECT name FROM provisioned WHERE kind = 'user'")
      .all();
    expect(names[0]?.name).toMatch(/^[0-9a-f]{64}$/);
    await apply(yaml.replace('role: admin', 'role: admin, disabled: false'), {
      ADMIN_PASSWORD: `${strong}!`,
    });
    expect((await services.users.findByEmail('ada@example.com'))?.passwordHash).toBe(
      row?.passwordHash ?? '',
    );
  });

  test('changes a role, refuses a weak or clear password without quoting it, and disables on prune', async () => {
    await apply(
      'users:\n  ada@example.com: { name: Ada, role: admin }\n  bob@example.com: { name: Bob }\n',
    );
    await apply(
      'users:\n  ada@example.com: { name: Ada, role: admin }\n  bob@example.com: { name: Bob, role: editor }\n',
    );
    expect((await services.users.findByEmail('bob@example.com'))?.role).toBe('editor');
    const weak = apply(
      `users:\n  bob@example.com: { name: Bob, password: "${reference('WEAK')}" }\n`,
      { WEAK: 'short' },
    );
    await expect(weak).rejects.toThrow('Its password is refused');
    await expect(weak).rejects.not.toThrow('short');
    await expect(
      apply('users:\n  bob@example.com: { name: Bob, password: hunter2hunter2 }\n'),
    ).rejects.toThrow('holds a secret in clear');
    await apply(
      'users:\n  ada@example.com: { name: Ada, role: admin }\nprovisioning:\n  prune: true\n',
    );
    expect((await services.users.findByEmail('bob@example.com'))?.disabledAt).not.toBeNull();
  });

  test('turns on a provider the file vouches for, with its secret sealed', async () => {
    const provider = (secret: string) =>
      `signIn:\n  providers:\n    github:\n      kind: github\n      name: GitHub\n      clientId: Iv1.abc\n      clientSecret: "${secret}"\n`;
    await apply(provider(reference('GITHUB_SECRET')), { GITHUB_SECRET: 'github-secret-9d1e' });
    expect(services.signInSettings.view().providers).toMatchObject([
      { id: 'github', enabled: true },
    ]);
    expect(await services.signInSettings.credentials('github')).toEqual({
      clientId: 'Iv1.abc',
      clientSecret: 'github-secret-9d1e',
    });
    expect(services.managed.pathOf('provider', 'github')).toBe(path);
    await expect(apply(provider('in-clear'))).rejects.toThrow(
      'clientSecret holds a secret in clear',
    );
  });

  test('keeps passwords on until an admin can sign in through a provider, without failing', async () => {
    await apply('signIn:\n  passwordSignIn: false\n');
    expect(services.signInSettings.passwordSignIn()).toBe(true);
    expect(services.managed.pathsOf('settings')).toEqual({});
  });
});
