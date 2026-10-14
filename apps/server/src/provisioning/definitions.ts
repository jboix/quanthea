/**
 * Definitions in the configuration file, keyed by id:
 *
 * ```yaml
 * definitions:
 *   error-rate:
 *     name: Error rate
 *     meaning: ERROR events, excluding business errors and blocked media, over START events.
 *     bodies:
 *       - shape: ratio
 *         request: { kind: search-ratio, index: core_events, match: [...], of: [...] }
 * ```
 *
 * Every field but the id is the API's. A declared definition is read-only in the interface. A
 * change in the file adds a version, never rewrites one; an unchanged definition adds none.
 */
import { type Definition, definitionSchema } from '@quanthea/shared';
import type { ConfigFile } from '../config/config-file.ts';
import type { Definitions } from '../dashboards/definitions.ts';
import { type Applier, type Planned, provisioningActor } from './reconcile.ts';

/**
 * The definitions the file declares, checked.
 *
 * @param file - The configuration file.
 * @param issues - Collects what is wrong.
 * @returns The definitions.
 */
export function planDefinitions(file: ConfigFile, issues: string[]): Planned<Definition>[] {
  return Object.entries(file.sections.definitions ?? {}).flatMap(([id, declared]) => {
    const where = `definitions.${id}`;
    const parsed = definitionSchema.safeParse({ ...(declared as object), id });
    if (!parsed.success) {
      issues.push(
        ...parsed.error.issues.map((issue) => `${where}.${issue.path.join('.')}: ${issue.message}`),
      );
      return [];
    }
    return [{ name: id, path: file.origins[where] ?? '', desired: parsed.data, editable: [] }];
  });
}

/**
 * The latest version of a definition, deleted or not, for the next one to start from.
 *
 * @param definitions - The definitions.
 * @param id - The definition.
 * @returns The version, or `null` when there is none.
 */
function latestOf(definitions: Definitions, id: string): number | null {
  return definitions.history(id)[0]?.version ?? null;
}

/**
 * Applies declared definitions: a changed one becomes the next version, from the file.
 *
 * @param definitions - The definitions.
 * @returns The applier.
 */
export function definitionApplier(definitions: Definitions): Applier<Definition> {
  return {
    kind: 'definition',
    exists: (name) => definitions.list().some((each) => each.definition.id === name),
    apply: async (item) => {
      await definitions.save(
        item.desired,
        latestOf(definitions, item.name),
        provisioningActor,
        'file',
      );
      return 'applied';
    },
    remove: async (name) => {
      definitions.remove(name, latestOf(definitions, name) ?? 0, provisioningActor);
    },
  };
}
