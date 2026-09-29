/**
 * The query settings: query builders switched on or off, and the queries admins save. A thread
 * uses the default set (the queries switched on and every saved one), a set chosen when it was
 * started, or none.
 */
import {
  type QueryChoice,
  type QuerySettings,
  queryBuilders,
  type ThreadQueries,
} from '@querent/shared';
import type { AvailableQueries } from '../dashboards/queries/index.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { SettingsStore } from './settings-store.ts';

/** The query settings. */
export interface QuerySettingsService {
  /**
   * The settings.
   *
   * @returns The switched-off query builders and the saved ones.
   */
  get(): QuerySettings;
  /**
   * Saves the settings.
   *
   * @param settings - The settings.
   * @param actor - Who saves.
   * @returns The saved settings.
   */
  save(settings: QuerySettings, actor: string): QuerySettings;
  /**
   * The queries a thread may use.
   *
   * @param queries - The thread's choice.
   * @returns The query builders' ids and the saved queries.
   */
  available(queries: ThreadQueries): AvailableQueries;
  /**
   * Every query, for choosing when a thread starts.
   *
   * @returns The queries, built-in first, and whether the default set has each.
   */
  choices(): QueryChoice[];
}

/** What the query settings need. */
export interface QuerySettingsDependencies {
  /** The settings store. */
  readonly store: SettingsStore;
  /** Records who changed the settings. */
  readonly audit: AuditRepository;
}

/**
 * The queries of a thread's choice.
 *
 * @param settings - The query settings.
 * @param queries - The thread's choice.
 * @returns The query builders' ids and the saved queries.
 */
function availableFor(settings: QuerySettings, queries: ThreadQueries): AvailableQueries {
  if (queries.mode === 'free') return { builtIn: [], saved: [] };
  const ids = queryBuilders.map((query) => query.id);
  if (queries.mode === 'chosen') {
    const chosen = new Set(queries.ids);
    return {
      builtIn: ids.filter((id) => chosen.has(id)),
      saved: settings.saved.filter((query) => chosen.has(query.id)),
    };
  }
  return { builtIn: ids.filter((id) => !settings.disabled.includes(id)), saved: settings.saved };
}

/**
 * Every query as a choice.
 *
 * @param settings - The query settings.
 * @returns The choices.
 */
function choicesOf(settings: QuerySettings): QueryChoice[] {
  const builtIn = queryBuilders.map((query) => ({
    ...query,
    origin: 'built-in' as const,
    enabled: !settings.disabled.includes(query.id),
  }));
  const saved = settings.saved.map(({ id, name, description, language }) => ({
    id,
    name,
    description,
    language,
    origin: 'saved' as const,
    enabled: true,
  }));
  return [...builtIn, ...saved];
}

/**
 * Creates the query settings service.
 *
 * @param dependencies - The store and the audit log.
 * @returns The service.
 */
export function createQuerySettings(dependencies: QuerySettingsDependencies): QuerySettingsService {
  const { store, audit } = dependencies;
  return {
    get: () => store.read('recipes'),
    save(settings, actor) {
      store.write('recipes', settings);
      const detail = {
        disabled: settings.disabled,
        saved: settings.saved.map((query) => query.id),
      };
      audit.append({ actor, action: 'settings.queries', detail });
      return store.read('recipes');
    },
    available: (queries) => availableFor(store.read('recipes'), queries),
    choices: () => choicesOf(store.read('recipes')),
  };
}
