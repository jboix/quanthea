/**
 * Which columns a chart's roles take: the ones asked for, and for the rest, the first columns of
 * a fitting type that no other role took. A role that takes several columns takes every fitting
 * column left.
 */
import type { Dataset, Dimension } from '../dataset/contract.ts';
import type { RoleSpec } from './recipe.ts';

/** The columns of each role: one name, or several for a role that takes several. */
export type RoleColumns = Record<string, string | string[]>;

/**
 * The columns a role could take.
 *
 * @param spec - The role.
 * @param dimensions - The dataset's columns.
 * @param taken - The columns other roles took.
 * @returns The fitting columns, in order.
 */
function candidates(spec: RoleSpec, dimensions: readonly Dimension[], taken: ReadonlySet<string>) {
  return dimensions.filter((column) => !taken.has(column.name) && spec.types.includes(column.type));
}

/**
 * The names a role's value covers.
 *
 * @param value - One column or several.
 * @returns The names.
 */
function namesOf(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The order roles are filled in: required single roles, then optional ones, then roles that take
 * several columns.
 *
 * @param spec - The role.
 * @returns Its rank.
 */
function rankOf(spec: RoleSpec): number {
  if (spec.multiple) return 2;
  return spec.required ? 0 : 1;
}

/**
 * The columns a role takes among those that fit.
 *
 * @param spec - The role.
 * @param fitting - The fitting columns, in order.
 * @returns All of them for a role that takes several, else the first.
 */
function chosenFor(spec: RoleSpec, fitting: readonly Dimension[]): string[] {
  const names = fitting.map((column) => column.name);
  return spec.multiple ? names : names.slice(0, 1);
}

/**
 * Fills in the roles not asked for, from the columns left. Single roles go first, required before
 * optional; an optional single role takes a column only when one fits; roles that take several
 * columns go last.
 *
 * @param roles - The recipe's roles.
 * @param dataset - The data.
 * @param asked - The columns asked for, by role.
 * @returns Every role that got a column.
 */
export function inferRoles(
  roles: Readonly<Record<string, RoleSpec>>,
  dataset: Dataset,
  asked: RoleColumns = {},
): RoleColumns {
  const result: RoleColumns = { ...asked };
  const taken = new Set(Object.values(asked).flatMap(namesOf));
  const open = Object.entries(roles).filter(([name]) => result[name] === undefined);
  for (const [name, spec] of open.sort(([, a], [, b]) => rankOf(a) - rankOf(b))) {
    const chosen = chosenFor(spec, candidates(spec, dataset.dimensions, taken));
    if (chosen.length === 0) continue;
    result[name] = spec.multiple ? chosen : (chosen[0] ?? '');
    for (const column of chosen) taken.add(column);
  }
  return result;
}

/**
 * What is wrong with the columns of each role: missing required roles, unknown columns, and
 * columns of the wrong type.
 *
 * @param roles - The recipe's roles.
 * @param dataset - The data.
 * @param columns - The columns of each role.
 * @returns One sentence per problem.
 */
export function roleProblems(
  roles: Readonly<Record<string, RoleSpec>>,
  dataset: Dataset,
  columns: RoleColumns,
): string[] {
  return Object.entries(roles).flatMap(([name, spec]) => {
    const names = namesOf(columns[name]);
    if (names.length === 0) return spec.required ? [`The ${name} role needs a column.`] : [];
    return names.flatMap((column) => {
      const found = dataset.dimensions.find((dimension) => dimension.name === column);
      if (!found) return [`The ${name} role names "${column}", which the data has not.`];
      if (!spec.types.includes(found.type))
        return [`The ${name} role needs ${spec.types.join(' or ')}; "${column}" is ${found.type}.`];
      return [];
    });
  });
}
