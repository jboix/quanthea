/**
 * The recipe settings: built-in recipes switched on or off, and the recipes admins save. A thread
 * uses the default set (the recipes switched on and every saved one), a set chosen when it was
 * started, or none.
 */
import {
  type QueryChoice,
  type QuerySettings,
  queryBuilders,
  type ThreadQueries,
} from '@querent/shared';
import type { AvailableQueries } from '../dashboards/recipes/index.ts';
import type { AuditRepository } from '../db/audit-repository.ts';
import type { SettingsStore } from './settings-store.ts';

/** The recipe settings. */
export interface QuerySettingsService {
  /**
   * The settings.
   *
   * @returns The switched-off built-in recipes and the saved ones.
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
   * The recipes a thread may use.
   *
   * @param recipes - The thread's choice.
   * @returns The built-in recipes' ids and the saved recipes.
   */
  available(recipes: ThreadQueries): AvailableQueries;
  /**
   * Every recipe, for choosing when a thread starts.
   *
   * @returns The recipes, built-in first, and whether the default set has each.
   */
  choices(): QueryChoice[];
}

/** What the recipe settings need. */
export interface QuerySettingsDependencies {
  /** The settings store. */
  readonly store: SettingsStore;
  /** Records who changed the settings. */
  readonly audit: AuditRepository;
}

/**
 * The recipes of a thread's choice.
 *
 * @param settings - The recipe settings.
 * @param recipes - The thread's choice.
 * @returns The built-in recipes' ids and the saved recipes.
 */
function availableFor(settings: QuerySettings, recipes: ThreadQueries): AvailableQueries {
  if (recipes.mode === 'free') return { builtIn: [], saved: [] };
  const ids = queryBuilders.map((recipe) => recipe.id);
  if (recipes.mode === 'chosen') {
    const chosen = new Set(recipes.ids);
    return {
      builtIn: ids.filter((id) => chosen.has(id)),
      saved: settings.saved.filter((recipe) => chosen.has(recipe.id)),
    };
  }
  return { builtIn: ids.filter((id) => !settings.disabled.includes(id)), saved: settings.saved };
}

/**
 * Every recipe as a choice.
 *
 * @param settings - The recipe settings.
 * @returns The choices.
 */
function choicesOf(settings: QuerySettings): QueryChoice[] {
  const builtIn = queryBuilders.map((recipe) => ({
    ...recipe,
    origin: 'built-in' as const,
    enabled: !settings.disabled.includes(recipe.id),
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
 * Creates the recipe settings service.
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
        saved: settings.saved.map((recipe) => recipe.id),
      };
      audit.append({ actor, action: 'settings.queries', detail });
      return store.read('recipes');
    },
    available: (recipes) => availableFor(store.read('recipes'), recipes),
    choices: () => choicesOf(store.read('recipes')),
  };
}
