/**
 * Writes the current configuration as a configuration file, to start one from what was set up in
 * the interface. Every secret, and every provider's client id, becomes a `${VARIABLE}` reference
 * to set in the environment; no secret leaves the server.
 */
import type { ServerSettingsView } from '@querent/shared';
import type { Users } from '../auth/users.ts';
import { configSchemaUrl } from './file-schema.ts';
import type { ProvisionServices } from './provision.ts';

/** What exporting needs. */
export interface ExportServices extends Omit<ProvisionServices, 'userRows' | 'userAdmin'> {
  /** The users. */
  readonly users: Users;
}

/** The system settings worth carrying to another install; ports and directories are its own. */
const portableSettings = new Set([
  'publicUrl',
  'trustedProxyHops',
  'authMode',
  'logLevel',
  'logFormat',
]);

/**
 * A reference to an environment variable, named from its parts.
 *
 * @param parts - Such as `connector`, `orders`, `password`.
 * @returns Such as `${CONNECTOR_ORDERS_PASSWORD}`.
 */
function reference(...parts: string[]): string {
  const name = parts
    .join('_')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
  return ['$', '{', name, '}'].join('');
}

/**
 * The system settings not left to their default.
 *
 * @param view - The system settings.
 * @returns The `server` section, or `undefined` when all are defaults.
 */
function serverOf(view: ServerSettingsView): Record<string, unknown> | undefined {
  const entries = view.settings
    .filter((setting) => portableSettings.has(setting.key) && setting.source.kind !== 'default')
    .map((setting) => {
      const value = setting.key === 'trustedProxyHops' ? Number(setting.value) : setting.value;
      return [setting.key, value];
    });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * The users, by email.
 *
 * @param users - The users.
 * @returns The `users` section.
 */
async function usersOf(users: Users): Promise<Record<string, unknown>> {
  const list = await users.list();
  return Object.fromEntries(
    list.map((user) => [
      user.email,
      { name: user.name, role: user.role, ...(user.disabled ? { disabled: true } : {}) },
    ]),
  );
}

/**
 * The sign-in providers, with their client id and secret as references.
 *
 * @param services - The sign-in settings.
 * @returns The `signIn` section.
 */
function signInOf(services: ExportServices): Record<string, unknown> {
  const view = services.signInSettings.view();
  const providers = Object.fromEntries(
    view.providers.map((provider) => [
      provider.id,
      {
        kind: provider.kind,
        name: provider.name,
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
        ...(provider.tenant ? { tenant: provider.tenant } : {}),
        join: provider.join,
        clientId: reference('sign-in', provider.id, 'client-id'),
        clientSecret: reference('sign-in', provider.id, 'client-secret'),
        enabled: provider.enabled,
      },
    ]),
  );
  return { passwordSignIn: view.passwordSignIn, providers };
}

/**
 * The connectors, by name, with their secret fields as references.
 *
 * @param services - The connections.
 * @returns The `connectors` section.
 */
async function connectorsOf(services: ExportServices): Promise<Record<string, unknown>> {
  const details = await Promise.all(
    services.connections.list().map((summary) => services.connections.get(summary.id)),
  );
  return Object.fromEntries(
    details.map((detail) => [
      detail.name,
      {
        kind: detail.kind,
        config: detail.config,
        secret: Object.fromEntries(
          Object.keys(detail.secret).map((field) => [
            field,
            reference('connector', detail.name, field),
          ]),
        ),
        accessLevel: detail.accessLevel,
        hiddenFields: detail.hiddenFields,
        guardrails: detail.guardrails,
        descriptions: detail.descriptions,
      },
    ]),
  );
}

/**
 * The model gateway, with each stored key as a reference.
 *
 * @param services - The model settings.
 * @returns The `model` section.
 */
async function modelOf(services: ExportServices): Promise<Record<string, unknown>> {
  const { gateway, keys } = await services.modelSettings.view();
  const providers = gateway.providers.map((provider) =>
    keys[provider.id]
      ? { ...provider, apiKey: reference('model', provider.id, 'api-key') }
      : provider,
  );
  return { ...gateway, providers };
}

/**
 * The current configuration, as a configuration file.
 *
 * @param services - The services that hold it.
 * @param server - The system settings.
 * @param now - The time of the export.
 * @returns The file's YAML.
 */
export async function exportConfiguration(
  services: ExportServices,
  server: ServerSettingsView,
  now: Date = new Date(),
): Promise<string> {
  const document = {
    ...(serverOf(server) ? { server: serverOf(server) } : {}),
    users: await usersOf(services.users),
    signIn: signInOf(services),
    connectors: await connectorsOf(services),
    model: await modelOf(services),
    retention: services.retention.get(),
    charts: services.chartSettings.get(),
    queries: services.querySettings.get(),
  };
  const header = [
    `# yaml-language-server: $schema=${configSchemaUrl}`,
    `# querent configuration, exported on ${now.toISOString().slice(0, 10)}.`,
    '# Set every variable reference below in querent’s environment, or change it to file:/path.',
  ];
  const body = Bun.YAML.stringify(document, null, 2).replace(/ +$/gm, '');
  return `${header.join('\n')}\n${body}\n`;
}
