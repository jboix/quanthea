/**
 * Provisioning at startup: applies the configuration file once; a change waits for the next
 * restart. Without a file, whatever an earlier file managed is released to the interface.
 */
import type { ConfigFile } from '../config/config-file.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import type { openDatabase } from '../db/database.ts';
import { createProvisionedRepository } from '../db/provisioned-repository.ts';
import type { Logger } from '../lib/logger.ts';
import type { KeyRing } from '../secrets/keys.ts';
import { type ProvisionServices, provision } from './provision.ts';

/** A configuration without any file. */
const noFile: ConfigFile = { paths: [], sections: {}, raw: {}, origins: {} };

/** What provisioning at startup needs. */
export interface StartProvisioningDependencies {
  /** The file as read at startup. */
  readonly file: ConfigFile | undefined;
  /** The database. */
  readonly database: ReturnType<typeof openDatabase>;
  /** The keys. */
  readonly keys: Pick<KeyRing, 'fingerprints' | 'emailIndex' | 'peppers'>;
  /** The services. */
  readonly services: ProvisionServices;
  /** Receives what happened. */
  readonly logger: Logger;
}

/**
 * Applies the file.
 *
 * @param dependencies - The file, the database, the keys and the services.
 * @returns Once it is applied.
 * @throws {Error} When the file cannot be applied, listing every issue.
 */
export async function startProvisioning(
  dependencies: StartProvisioningDependencies,
): Promise<void> {
  const { database, keys, services, logger } = dependencies;
  await provision({
    file: dependencies.file ?? noFile,
    repository: createProvisionedRepository(database),
    fingerprints: keys.fingerprints,
    emailIndex: keys.emailIndex,
    peppers: keys.peppers,
    services,
    audit: createAuditRepository(database),
    logger,
  });
}
