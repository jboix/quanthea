/**
 * Applies the configuration file's sections to what querent stores, in an order that lets each
 * one rely on the last: users, sign-in providers, password sign-in, settings, then connectors. At
 * startup, any problem stops the server with every issue listed.
 */
import { z } from 'zod';
import type { SignInSettings } from '../auth/providers/sign-in-settings.ts';
import type { ConfigFile } from '../config/config-file.ts';
import type { Connections } from '../connections/connections.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { ProvisionedRepository } from '../db/provisioned-repository.ts';
import type { Logger } from '../lib/logger.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';
import type { Peppers } from '../secrets/keys.ts';
import { connectorApplier, planConnectors } from './connectors.ts';
import { issuesAt, type ProvisioningContext, reconcile } from './reconcile.ts';
import { planSettings, type SettingsServices, settingsApplier } from './settings-sections.ts';
import {
  passwordSignInApplier,
  planPasswordSignIn,
  planProviders,
  providerApplier,
  unknownSignInKeys,
} from './sign-in.ts';
import { planUsers, type UserServices, userApplier } from './users.ts';

/** The file's `provisioning` section. */
const provisioningSchema = z
  .object({
    /** Deletes what the file no longer declares, instead of releasing it to the interface. */
    prune: z.boolean().default(false),
  })
  .strict();

/** The services the file's sections are applied through. */
export interface ProvisionServices extends SettingsServices, UserServices {
  /** The connections. */
  readonly connections: Connections;
  /** The sign-in settings. */
  readonly signInSettings: SignInSettings;
}

/** What applying the file needs. */
export interface ProvisionDependencies {
  /** The configuration file. */
  readonly file: ConfigFile;
  /** Records what the file manages. */
  readonly repository: ProvisionedRepository;
  /** Hashes declarations, under a key the database does not hold. */
  readonly fingerprints: KeyedHash;
  /** Indexes emails, to name users without their email. */
  readonly emailIndex: KeyedHash;
  /** The peppers, for a user's first password. */
  readonly peppers: Peppers;
  /** The services. */
  readonly services: ProvisionServices;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** Receives what happened. */
  readonly logger: Logger;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/**
 * Whether the file asks to delete what it no longer declares.
 *
 * @param file - The configuration file.
 * @param issues - Collects what is wrong.
 * @returns Whether it does.
 */
function pruneOf(file: ConfigFile, issues: string[]): boolean {
  const parsed = provisioningSchema.safeParse(file.sections.provisioning ?? {});
  if (parsed.success) return parsed.data.prune;
  issues.push(...issuesAt('provisioning', parsed.error));
  return false;
}

/**
 * Checks every section, before anything is applied.
 *
 * @param dependencies - The file and the keys.
 * @returns The items of each section, and what is wrong.
 */
async function planAll(dependencies: ProvisionDependencies) {
  const { file } = dependencies;
  const issues: string[] = [...unknownSignInKeys(file)];
  const plans = {
    prune: pruneOf(file, issues),
    users: await planUsers(file, dependencies.emailIndex, issues),
    providers: planProviders(file, issues),
    passwordSignIn: planPasswordSignIn(file, issues),
    settings: planSettings(file, issues),
    connectors: planConnectors(file, issues),
  };
  return { plans, issues };
}

/**
 * Applies the file. Nothing is applied when the file holds a mistake; an item that fails to apply
 * is reported while the others apply.
 *
 * @param dependencies - The file, the keys, the services and the repository.
 * @returns Once it is applied.
 * @throws {Error} Listing every issue.
 */
export async function provision(dependencies: ProvisionDependencies): Promise<void> {
  const { services, logger } = dependencies;
  const { plans, issues } = await planAll(dependencies);
  if (issues.length > 0) throw new Error(`Invalid configuration:\n- ${issues.join('\n- ')}`);
  const now = dependencies.now ?? Date.now;
  const context: ProvisioningContext = { ...dependencies, prune: plans.prune, now };
  const failures = [
    ...(await reconcile(context, userApplier(services, dependencies.peppers), plans.users)),
    ...(await reconcile(context, providerApplier(services.signInSettings), plans.providers)),
    ...(await reconcile(
      context,
      passwordSignInApplier(services.signInSettings, logger),
      plans.passwordSignIn,
    )),
    ...(await reconcile(context, settingsApplier(services), plans.settings)),
    ...(await reconcile(context, connectorApplier(services.connections, logger), plans.connectors)),
  ];
  if (failures.length > 0)
    throw new Error(`The configuration could not be applied:\n- ${failures.join('\n- ')}`);
}
