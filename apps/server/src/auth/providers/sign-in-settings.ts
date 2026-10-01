/**
 * The sign-in settings: the providers, their sealed credentials, and whether passwords sign in.
 */
import type { IdentityProviderView, StoredProvider } from '@quanthea/shared';
import type { AuditRepository } from '../../db/audit-repository.ts';
import type { IdentityRepository } from '../../db/identity-repository.ts';
import type { UserRepository } from '../../db/user-repository.ts';
import { AppError } from '../../lib/errors.ts';
import type { SecretBox } from '../../secrets/secret-box.ts';
import type { SettingsStore } from '../../settings/settings-store.ts';
import {
  checkedFields,
  credentialsOwner,
  type ProviderCredentials,
  type ProviderInput,
  providerView,
} from './provider-settings.ts';

/** What the sign-in settings need. */
export interface SignInSettingsDependencies {
  /** Stores the settings. */
  readonly store: SettingsStore;
  /** Seals the credentials. */
  readonly secretBox: SecretBox;
  /** The linked identities, dropped with their provider. */
  readonly identities: IdentityRepository;
  /** The users, to check an admin can still sign in. */
  readonly users: UserRepository;
  /** quanthea's origin, for callback URLs. */
  readonly publicUrl: string | undefined;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The sign-in settings as an admin sees them. */
export interface SignInSettingsView {
  /** The providers. */
  readonly providers: IdentityProviderView[];
  /** Whether passwords sign in. */
  readonly passwordSignIn: boolean;
  /** quanthea's origin, or `null` when the server has none. */
  readonly publicUrl: string | null;
}

/** The sign-in settings. */
export interface SignInSettings {
  /**
   * The settings as an admin sees them.
   *
   * @returns The view.
   */
  view(): SignInSettingsView;
  /**
   * Creates or changes a provider.
   *
   * @param id - The provider id.
   * @param input - Its settings, and new credentials when sent.
   * @param actor - Who saves.
   * @throws {AppError} `bad_request` for a setting its kind refuses, or a new provider without
   *   credentials.
   */
  save(id: string, input: ProviderInput, actor: string): Promise<void>;
  /**
   * Turns a provider on or off.
   *
   * @param id - The provider id.
   * @param enabled - On or off.
   * @param actor - Who.
   * @throws {AppError} `bad_request` to turn on one that has not passed a test sign-in.
   */
  enable(id: string, enabled: boolean, actor: string): void;
  /**
   * Removes a provider, its credentials and every identity linked through it.
   *
   * @param id - The provider id.
   * @param actor - Who.
   */
  remove(id: string, actor: string): void;
  /**
   * Turns password sign-in on or off.
   *
   * @param enabled - On or off.
   * @param actor - Who.
   * @throws {AppError} `bad_request` to turn it off while no admin can sign in through a provider.
   */
  setPasswordSignIn(enabled: boolean, actor: string): void;
  /**
   * A provider's stored settings.
   *
   * @param id - The provider id.
   * @returns The provider, or `undefined`.
   */
  provider(id: string): StoredProvider | undefined;
  /**
   * A provider's client id and secret.
   *
   * @param id - The provider id.
   * @returns The credentials, or `undefined` when none are saved.
   */
  credentials(id: string): Promise<ProviderCredentials | undefined>;
  /**
   * Records a successful test sign-in, which lets the provider be turned on.
   *
   * @param id - The provider id.
   * @param actor - Who tested it.
   */
  markTested(id: string, actor: string): void;
  /**
   * Whether passwords sign in.
   *
   * @returns Whether they do.
   */
  passwordSignIn(): boolean;
}

/**
 * Writes the providers.
 *
 * @param store - The settings store.
 * @param providers - The providers.
 */
function writeProviders(store: SettingsStore, providers: StoredProvider[]): void {
  store.write('sign-in', { ...store.read('sign-in'), providers });
}

/**
 * Seals and stores new credentials, keeping the id when only the secret is new.
 *
 * @param dependencies - The sign-in settings' dependencies.
 * @param id - The provider id.
 * @param input - What the admin sent.
 * @returns Whether the credentials changed.
 * @throws {AppError} `bad_request` for a new provider without both.
 */
async function storeCredentials(
  dependencies: SignInSettingsDependencies,
  id: string,
  input: ProviderInput,
): Promise<boolean> {
  if (!input.clientId && !input.clientSecret) return false;
  const before = await credentialsOf(dependencies, id);
  const clientId = input.clientId ?? before?.clientId;
  const clientSecret = input.clientSecret ?? before?.clientSecret;
  if (!clientId || !clientSecret)
    throw new AppError('bad_request', 'Give both the client id and the client secret.');
  const sealed = await dependencies.secretBox.seal(
    JSON.stringify({ clientId, clientSecret }),
    credentialsOwner(id),
  );
  const { store } = dependencies;
  const all = store.read('sign-in-credentials').sealed;
  store.write('sign-in-credentials', {
    sealed: { ...all, [id]: Buffer.from(sealed).toString('base64') },
  });
  return true;
}

/**
 * A provider's credentials.
 *
 * @param dependencies - The sign-in settings' dependencies.
 * @param id - The provider id.
 * @returns The credentials, or `undefined`.
 */
async function credentialsOf(
  dependencies: SignInSettingsDependencies,
  id: string,
): Promise<ProviderCredentials | undefined> {
  const sealed = dependencies.store.read('sign-in-credentials').sealed[id];
  if (sealed === undefined) return undefined;
  const opened = await dependencies.secretBox.open(
    Buffer.from(sealed, 'base64'),
    credentialsOwner(id),
  );
  return JSON.parse(opened) as ProviderCredentials;
}

/**
 * A provider after a save: turned off and untested when it signs people in another way.
 *
 * @param before - The provider before, if any.
 * @param next - Its new id, kind, name and checked fields.
 * @param credentialsChanged - Whether new credentials were saved.
 * @returns The provider to store.
 */
function savedProvider(
  before: StoredProvider | undefined,
  next: Omit<StoredProvider, 'enabled' | 'testedAt'>,
  credentialsChanged: boolean,
): StoredProvider {
  const sameWay =
    before?.kind === next.kind && before.baseUrl === next.baseUrl && before.tenant === next.tenant;
  if (!before || !sameWay || credentialsChanged) return { ...next, enabled: false, testedAt: null };
  return { ...next, enabled: before.enabled, testedAt: before.testedAt };
}

/**
 * Creates or changes a provider.
 *
 * @param dependencies - The sign-in settings' dependencies.
 * @param id - The provider id.
 * @param input - What the admin sent.
 * @param actor - Who saves.
 */
async function save(
  dependencies: SignInSettingsDependencies,
  id: string,
  input: ProviderInput,
  actor: string,
): Promise<void> {
  const { store } = dependencies;
  const fields = checkedFields(input);
  const providers = store.read('sign-in').providers;
  const before = providers.find((provider) => provider.id === id);
  if (!before && (!input.clientId || !input.clientSecret))
    throw new AppError('bad_request', 'A new provider needs its client id and client secret.');
  const credentialsChanged = await storeCredentials(dependencies, id, input);
  const next = { id, kind: input.kind, name: input.name, ...fields };
  const provider = savedProvider(before, next, credentialsChanged);
  writeProviders(store, [...providers.filter((each) => each.id !== id), provider]);
  const detail = { kind: input.kind, join: fields.join.mode };
  dependencies.audit.append({ actor, action: 'settings.sign-in-provider', target: id, detail });
}

/**
 * Whether an enabled admin can sign in through an enabled provider.
 *
 * @param dependencies - The sign-in settings' dependencies.
 * @param enabledIds - The enabled providers.
 * @returns Whether one can.
 */
function adminHasProvider(
  dependencies: SignInSettingsDependencies,
  enabledIds: Set<string>,
): boolean {
  return dependencies.users
    .list()
    .filter((row) => row.role === 'admin' && row.disabledAt === null)
    .some((row) =>
      dependencies.identities.listOf(row.id).some((each) => enabledIds.has(each.providerId)),
    );
}

/**
 * Changes one provider with a function.
 *
 * @param store - The settings store.
 * @param id - The provider id.
 * @param change - The change.
 * @throws {AppError} `not_found`.
 */
function changeProvider(
  store: SettingsStore,
  id: string,
  change: (provider: StoredProvider) => StoredProvider,
): void {
  const providers = store.read('sign-in').providers;
  const found = providers.find((each) => each.id === id);
  if (!found) throw new AppError('not_found', `No provider ${id}.`);
  writeProviders(
    store,
    providers.map((each) => (each.id === id ? change(each) : each)),
  );
}

/**
 * The settings as an admin sees them.
 *
 * @param dependencies - The sign-in settings' dependencies.
 * @returns The view.
 */
function viewOf(dependencies: SignInSettingsDependencies): SignInSettingsView {
  const { providers, passwordSignIn } = dependencies.store.read('sign-in');
  const sealed = dependencies.store.read('sign-in-credentials').sealed;
  const publicUrl = dependencies.publicUrl ?? '';
  const views = providers.map((each) => providerView(each, each.id in sealed, publicUrl));
  return { providers: views, passwordSignIn, publicUrl: dependencies.publicUrl ?? null };
}

/**
 * Removes a provider, its credentials and every identity linked through it.
 *
 * @param dependencies - The sign-in settings' dependencies.
 * @param id - The provider id.
 * @param actor - Who.
 */
function remove(dependencies: SignInSettingsDependencies, id: string, actor: string): void {
  const { store } = dependencies;
  writeProviders(
    store,
    store.read('sign-in').providers.filter((each) => each.id !== id),
  );
  const { [id]: _removed, ...sealed } = store.read('sign-in-credentials').sealed;
  store.write('sign-in-credentials', { sealed });
  for (const row of dependencies.users.list()) dependencies.identities.unlink(row.id, id);
  dependencies.audit.append({ actor, action: 'settings.sign-in-provider-removed', target: id });
}

/**
 * Turns password sign-in on or off.
 *
 * @param dependencies - The sign-in settings' dependencies.
 * @param enabled - On or off.
 * @param actor - Who.
 */
function setPasswordSignIn(
  dependencies: SignInSettingsDependencies,
  enabled: boolean,
  actor: string,
): void {
  const { store } = dependencies;
  const enabledIds = new Set(
    store
      .read('sign-in')
      .providers.filter((each) => each.enabled)
      .map((each) => each.id),
  );
  if (!enabled && !adminHasProvider(dependencies, enabledIds))
    throw new AppError(
      'bad_request',
      'Link an admin to a provider that is on before turning passwords off.',
    );
  store.write('sign-in', { ...store.read('sign-in'), passwordSignIn: enabled });
  dependencies.audit.append({ actor, action: 'settings.password-sign-in', detail: { enabled } });
}

/**
 * Turns a provider on or off.
 *
 * @param dependencies - The sign-in settings' dependencies.
 * @param id - The provider id.
 * @param enabled - On or off.
 * @param actor - Who.
 */
function enable(
  dependencies: SignInSettingsDependencies,
  id: string,
  enabled: boolean,
  actor: string,
) {
  changeProvider(dependencies.store, id, (provider) => {
    if (enabled && provider.testedAt === null)
      throw new AppError('bad_request', 'Test a sign-in with this provider before turning it on.');
    return { ...provider, enabled };
  });
  const detail = { enabled };
  dependencies.audit.append({
    actor,
    action: 'settings.sign-in-provider-enabled',
    target: id,
    detail,
  });
}

/**
 * Creates the sign-in settings.
 *
 * @param dependencies - The store, secret box, identities, users, public URL, audit log and clock.
 * @returns The service.
 */
export function createSignInSettings(dependencies: SignInSettingsDependencies): SignInSettings {
  const { store, audit } = dependencies;
  const now = dependencies.now ?? Date.now;
  return {
    view: () => viewOf(dependencies),
    save: (id, input, actor) => save(dependencies, id, input, actor),
    enable: (id, enabled, actor) => enable(dependencies, id, enabled, actor),
    remove: (id, actor) => remove(dependencies, id, actor),
    setPasswordSignIn: (enabled, actor) => setPasswordSignIn(dependencies, enabled, actor),
    provider: (id) => store.read('sign-in').providers.find((each) => each.id === id),
    credentials: (id) => credentialsOf(dependencies, id),
    markTested: (id, actor) => {
      changeProvider(store, id, (provider) => ({ ...provider, testedAt: now() }));
      audit.append({ actor, action: 'settings.sign-in-provider-tested', target: id });
    },
    passwordSignIn: () => store.read('sign-in').passwordSignIn,
  };
}
