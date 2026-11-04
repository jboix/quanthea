/**
 * The external hosts: where dashboards may link to and load images from, each any host or only
 * the hosts an admin lists.
 */
import type { ExternalHosts } from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { SettingsStore } from './settings-store.ts';

/** The external hosts. */
export interface ExternalHostsService {
  /**
   * The settings.
   *
   * @returns Where links may go, and where images may load from.
   */
  get(): ExternalHosts;
  /**
   * Saves the settings and records the hosts before and after.
   *
   * @param settings - The settings.
   * @param actor - Who saves.
   * @returns The saved settings.
   */
  save(settings: ExternalHosts, actor: string): ExternalHosts;
  /**
   * Where images may load from, kept in memory until the next save: every page's
   * Content-Security-Policy names it.
   *
   * @returns `'any'` for any host, else the host names.
   */
  imageHosts(): readonly string[] | 'any';
}

/** What the external hosts need. */
export interface ExternalHostsDependencies {
  /** The settings store. */
  readonly store: SettingsStore;
  /** Records who changed the hosts. */
  readonly audit: AuditRepository;
}

/**
 * Creates the external hosts service.
 *
 * @param dependencies - The store and the audit log.
 * @returns The service.
 */
export function createExternalHosts(dependencies: ExternalHostsDependencies): ExternalHostsService {
  const { store, audit } = dependencies;
  let images: readonly string[] | 'any' | undefined;
  return {
    get: () => store.read('external-hosts'),
    save(settings, actor) {
      const before = store.read('external-hosts');
      store.write('external-hosts', settings);
      const after = store.read('external-hosts');
      images = undefined;
      audit.append({ actor, action: 'settings.external-hosts', detail: { before, after } });
      return after;
    },
    imageHosts() {
      if (images === undefined) {
        const reach = store.read('external-hosts').images;
        images = reach.anyHost ? 'any' : reach.hosts;
      }
      return images;
    },
  };
}
