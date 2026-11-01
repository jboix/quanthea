/**
 * The external hosts: where dashboards may link and load images from. Links go to any host until
 * an admin narrows them; images load only from hosts an admin lists for them.
 */
import type { ExternalHosts } from '@quanthea/shared';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { SettingsStore } from './settings-store.ts';

/** The external hosts. */
export interface ExternalHostsService {
  /**
   * The settings.
   *
   * @returns Whether links go to any host, and the hosts listed.
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
   * The hosts images may load from, kept in memory until the next save: every page's
   * Content-Security-Policy names them.
   *
   * @returns The host names.
   */
  imageHosts(): readonly string[];
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
  let images: readonly string[] | undefined;
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
      images ??= store
        .read('external-hosts')
        .hosts.filter((each) => each.images)
        .map((each) => each.host);
      return images;
    },
  };
}
