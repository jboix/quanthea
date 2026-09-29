/**
 * Applies the configuration file's sections to what querent stores. At startup, any problem
 * stops the server with every issue listed.
 */
import { z } from 'zod';
import type { ConfigFile } from '../config/config-file.ts';
import type { Connections } from '../connections/connections.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { ProvisionedRepository } from '../db/provisioned-repository.ts';
import type { Logger } from '../lib/logger.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';
import { connectorApplier, planConnectors } from './connectors.ts';
import { type ProvisioningContext, reconcile } from './reconcile.ts';
import { planSettings, type SettingsServices, settingsApplier } from './settings-sections.ts';

/** The file's `provisioning` section. */
const provisioningSchema = z
  .object({
    /** Deletes what the file no longer declares, instead of releasing it to the interface. */
    prune: z.boolean().default(false),
  })
  .strict();

/** What applying the file needs. */
export interface ProvisionDependencies {
  /** The configuration file. */
  readonly file: ConfigFile;
  /** Records what the file manages. */
  readonly repository: ProvisionedRepository;
  /** Hashes declarations, under a key the database does not hold. */
  readonly fingerprints: KeyedHash;
  /** The connections. */
  readonly connections: Connections;
  /** The settings services. */
  readonly settings: SettingsServices;
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
  issues.push(
    ...parsed.error.issues.map((issue) => `provisioning.${issue.path.join('.')}: ${issue.message}`),
  );
  return false;
}

/**
 * Applies the file. Nothing is applied when the file holds a mistake; an item that fails to apply
 * is reported while the others apply.
 *
 * @param dependencies - The file, the services and the repository.
 * @returns Once it is applied.
 * @throws {Error} Listing every issue.
 */
export async function provision(dependencies: ProvisionDependencies): Promise<void> {
  const { file, logger } = dependencies;
  const issues: string[] = [];
  const prune = pruneOf(file, issues);
  const settings = planSettings(file, issues);
  const connectors = planConnectors(file, issues);
  if (issues.length > 0) throw new Error(`Invalid configuration:\n- ${issues.join('\n- ')}`);
  const now = dependencies.now ?? Date.now;
  const context: ProvisioningContext = { ...dependencies, prune, now };
  const failures = [
    ...(await reconcile(context, settingsApplier(dependencies.settings), settings)),
    ...(await reconcile(context, connectorApplier(dependencies.connections, logger), connectors)),
  ];
  if (failures.length > 0)
    throw new Error(`The configuration could not be applied:\n- ${failures.join('\n- ')}`);
}
