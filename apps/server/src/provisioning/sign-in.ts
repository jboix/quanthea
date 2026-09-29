/**
 * Sign-in in the configuration file: the providers, keyed by id, and whether passwords sign in.
 *
 * ```yaml
 * signIn:
 *   passwordSignIn: false
 *   providers:
 *     google:
 *       kind: google
 *       name: Google
 *       join: { mode: domain, values: [example.com] }
 *       clientId: 1234.apps.googleusercontent.com
 *       clientSecret: ${GOOGLE_CLIENT_SECRET}
 * ```
 *
 * The client secret is a secret; the client id may be written in clear or as a reference. The file
 * vouches for a provider, so one it declares enabled needs no test sign-in. Turning passwords off
 * waits until an admin can sign in through a provider, and a later start applies it.
 */
import { joinPolicySchema, providerKinds } from '@querent/shared';
import { z } from 'zod';
import type { SignInSettings } from '../auth/providers/sign-in-settings.ts';
import type { ConfigFile } from '../config/config-file.ts';
import { AppError } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import { type Applier, issuesAt, type Planned, provisioningActor } from './reconcile.ts';
import { secretValue } from './secret-references.ts';

/** A provider as the file declares it, without its client secret. */
export const declaredSchema = z
  .object({
    kind: z.enum(providerKinds),
    name: z.string().trim().min(1).max(60),
    baseUrl: z.string().trim().max(200).nullable().default(null),
    tenant: z.string().trim().max(100).nullable().default(null),
    join: joinPolicySchema.default({ mode: 'invite', values: [] }),
    clientId: z.string().trim().min(1).max(500),
    enabled: z.boolean().default(true),
  })
  .strict();

/** A provider ready to apply. */
type DesiredProvider = z.output<typeof declaredSchema> & {
  /** The client secret. */
  readonly clientSecret: string;
};

/** A provider id. */
const providerIdPattern = /^[a-z0-9-]{1,40}$/;

/** A whole value that is one variable reference or a file reference. */
const referencePattern = /^(\$\{[A-Za-z_][A-Za-z0-9_]*\}|file:.+)$/;

/**
 * The client id, from a reference when it is written as one.
 *
 * @param written - The value as written.
 * @param declared - The value, interpolated.
 * @param where - Where it is set, for messages.
 * @param issues - Collects what is wrong.
 * @returns The client id.
 */
function clientIdOf(written: unknown, declared: unknown, where: string, issues: string[]): unknown {
  if (typeof written !== 'string' || !referencePattern.test(written)) return declared;
  return secretValue(written, declared, where, issues);
}

/**
 * A provider's declaration, as written and interpolated.
 *
 * @param file - The configuration file.
 * @param id - The provider id.
 * @returns Both.
 */
function declarationOf(file: ConfigFile, id: string) {
  type Mapping = Record<string, Record<string, unknown>>;
  const declared = (file.sections.signIn?.providers ?? {}) as Mapping;
  const written = (file.raw.signIn?.providers ?? {}) as Mapping;
  return { declared: { ...declared[id] }, written: written[id] ?? {} };
}

/**
 * One provider as declared, checked.
 *
 * @param file - The configuration file.
 * @param id - The provider id.
 * @param issues - Collects what is wrong.
 * @returns The provider, or `undefined` when it is invalid.
 */
function planOne(
  file: ConfigFile,
  id: string,
  issues: string[],
): Planned<DesiredProvider> | undefined {
  const where = `signIn.providers.${id}`;
  const { declared, written } = declarationOf(file, id);
  const { clientSecret, ...fields } = declared;
  const secret = secretValue(written.clientSecret, clientSecret, `${where}.clientSecret`, issues);
  fields.clientId = clientIdOf(written.clientId, fields.clientId, `${where}.clientId`, issues);
  const parsed = declaredSchema.safeParse(fields);
  if (!parsed.success) issues.push(...issuesAt(where, parsed.error));
  if (!parsed.success || secret === undefined) return undefined;
  const path = file.origins['signIn.providers'] ?? '';
  return { name: id, path, desired: { ...parsed.data, clientSecret: secret }, editable: [] };
}

/**
 * The providers the file declares, checked.
 *
 * @param file - The configuration file.
 * @param issues - Collects what is wrong.
 * @returns The providers.
 */
export function planProviders(file: ConfigFile, issues: string[]): Planned<DesiredProvider>[] {
  const providers = file.sections.signIn?.providers;
  if (providers === undefined) return [];
  if (providers === null || typeof providers !== 'object') {
    issues.push('signIn.providers must be a mapping of providers by id.');
    return [];
  }
  return Object.keys(providers).flatMap((id) => {
    if (!providerIdPattern.test(id))
      issues.push(`signIn.providers.${id}: use lowercase letters, digits and dashes.`);
    const planned = planOne(file, id, issues);
    return planned ? [planned] : [];
  });
}

/**
 * Whether passwords sign in, when the file says.
 *
 * @param file - The configuration file.
 * @param issues - Collects what is wrong.
 * @returns The setting, or none when the file leaves it out.
 */
export function planPasswordSignIn(file: ConfigFile, issues: string[]): Planned<boolean>[] {
  const declared = file.sections.signIn?.passwordSignIn;
  if (declared === undefined) return [];
  if (typeof declared !== 'boolean') {
    issues.push('signIn.passwordSignIn must be true or false.');
    return [];
  }
  const path = file.origins['signIn.passwordSignIn'] ?? '';
  return [{ name: 'password-sign-in', path, desired: declared, editable: [] }];
}

/**
 * Keys of `signIn` the file may hold.
 *
 * @param file - The configuration file.
 * @returns One issue per unknown key.
 */
export function unknownSignInKeys(file: ConfigFile): string[] {
  return Object.keys(file.sections.signIn ?? {})
    .filter((key) => key !== 'providers' && key !== 'passwordSignIn')
    .map((key) => `signIn.${key} is not a setting. Known: providers, passwordSignIn.`);
}

/**
 * How providers are applied.
 *
 * @param settings - The sign-in settings.
 * @returns The applier.
 */
export function providerApplier(settings: SignInSettings): Applier<DesiredProvider> {
  return {
    kind: 'provider',
    exists: (id) => settings.provider(id) !== undefined,
    apply: async ({ name: id, desired }) => {
      const { enabled, ...input } = desired;
      await settings.save(id, input, provisioningActor);
      if (enabled) settings.markTested(id, provisioningActor);
      settings.enable(id, enabled, provisioningActor);
      return 'applied';
    },
    remove: async (id) => settings.remove(id, provisioningActor),
  };
}

/**
 * How password sign-in is applied. Turning it off before an admin can sign in through a provider
 * is deferred to a later start.
 *
 * @param settings - The sign-in settings.
 * @param logger - Receives the deferral.
 * @returns The applier.
 */
export function passwordSignInApplier(settings: SignInSettings, logger: Logger): Applier<boolean> {
  return {
    kind: 'settings',
    owns: (name) => name === 'password-sign-in',
    exists: () => true,
    apply: async ({ desired }) => {
      try {
        settings.setPasswordSignIn(desired, provisioningActor);
        return 'applied';
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        logger.warn('Password sign-in stays on until an admin signs in through a provider.', {});
        return 'deferred';
      }
    },
    remove: async () => undefined,
  };
}
