/**
 * Provisioning at startup: applies the configuration file once, then watches it. Without a file,
 * whatever an earlier file managed is released to the interface.
 */
import type { ConfigFile } from '../config/config-file.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import type { openDatabase } from '../db/database.ts';
import { createProvisionedRepository } from '../db/provisioned-repository.ts';
import type { Logger } from '../lib/logger.ts';
import type { KeyRing } from '../secrets/keys.ts';
import { type ProvisionServices, provision } from './provision.ts';
import type { ProvisioningStatus } from './status.ts';
import { watchConfig } from './watch.ts';

/** A configuration without any file. */
const noFile: ConfigFile = { paths: [], sections: {}, raw: {}, origins: {} };

/** What provisioning at startup needs. */
export interface StartProvisioningDependencies {
  /** What `QUERENT_CONFIG` names, if set. */
  readonly configPath: string | undefined;
  /** The file as read at startup. */
  readonly file: ConfigFile | undefined;
  /** The environment variables, for references. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The database. */
  readonly database: ReturnType<typeof openDatabase>;
  /** The keys. */
  readonly keys: Pick<KeyRing, 'fingerprints' | 'emailIndex' | 'peppers'>;
  /** The services, and the status admins see. */
  readonly services: ProvisionServices & { readonly provisioningStatus: ProvisioningStatus };
  /** Receives what happened. */
  readonly logger: Logger;
}

/**
 * Applies the file, then watches it for changes.
 *
 * @param dependencies - The file, the database, the keys and the services.
 * @returns A function that stops watching.
 * @throws {Error} When the file cannot be applied at startup, listing every issue.
 */
export async function startProvisioning(
  dependencies: StartProvisioningDependencies,
): Promise<() => void> {
  const { database, keys, services, logger } = dependencies;
  const apply = (file: ConfigFile) =>
    provision({
      file,
      repository: createProvisionedRepository(database),
      fingerprints: keys.fingerprints,
      emailIndex: keys.emailIndex,
      peppers: keys.peppers,
      services,
      audit: createAuditRepository(database),
      logger,
    });
  const file = dependencies.file ?? noFile;
  await apply(file);
  if (!dependencies.configPath) return () => undefined;
  return watchConfig({
    path: dependencies.configPath,
    environment: dependencies.environment,
    startupServer: file.sections.server ?? {},
    apply,
    status: services.provisioningStatus,
    logger,
  });
}
