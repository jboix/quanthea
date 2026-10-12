/**
 * Keeps a search off the indices its connector does not show. The source resolves the query's
 * index expression first; an index, alias or data stream the connector hides is refused when the
 * query names it, and excluded (`-name`) when a pattern reaches it.
 */
import { listShowsObject } from '@quanthea/shared';
import type { ConnectorInstance, SearchQuery } from '../../connectors/_shared/index.ts';
import { QueryError } from '../query-error.ts';
import {
  isSystemObject,
  notShown,
  type ObjectScope,
  restricts,
  showsObject,
} from './object-scope.ts';

/** What the source resolved an expression to. */
type Resolved = Awaited<ReturnType<NonNullable<ConnectorInstance['resolveObjects']>>>[number];

/** The most hidden names a query excludes; past that, the pattern is refused. */
const maxExclusions = 50;

/**
 * Whether an index behind an alias keeps the alias hidden: a system index, or one an `except` list
 * names. An `only` list is about the alias's own name.
 *
 * @param scope - The connector's scope.
 * @param member - The index behind the alias.
 * @returns `true` when the alias may not be read.
 */
function hidesAlias(scope: ObjectScope, member: string): boolean {
  const { showSystem, mode } = scope.visibility;
  if (!showSystem && isSystemObject(scope.family, member)) return true;
  return mode === 'except' && !listShowsObject(scope.visibility, member);
}

/**
 * Whether the connector shows something an expression reaches: its own name, and for an alias
 * every index behind it.
 *
 * @param scope - The connector's scope.
 * @param target - What the source resolved.
 * @returns `true` when a query may read it.
 */
function showsTarget(scope: ObjectScope, target: Resolved): boolean {
  if (!showsObject(scope, target.name)) return false;
  return !(target.members ?? []).some((member) => hidesAlias(scope, member));
}

/**
 * The error for a pattern that reaches too much, or nothing, of what the connector shows.
 *
 * @param hidden - How many of the names it reaches are hidden.
 * @param all - Whether every name it reaches is hidden.
 * @returns The error.
 */
function tooWide(hidden: number, all: boolean): QueryError {
  const reach = all
    ? 'The index pattern reaches nothing this connector shows.'
    : `The index pattern reaches ${hidden} indices this connector does not show.`;
  return new QueryError('invalid', `${reach} Name an index its schema lists, or its pattern.`);
}

/**
 * The names to exclude from an expression: the hidden ones a pattern reaches.
 *
 * @param scope - The connector's scope.
 * @param index - The index expression.
 * @param targets - What the source resolved it to.
 * @returns The hidden names.
 * @throws {QueryError} `invalid` when the query names a hidden one in full, when the pattern
 *   reaches nothing shown, or more hidden names than a query can exclude.
 */
function hiddenTargets(scope: ObjectScope, index: string, targets: readonly Resolved[]): string[] {
  const named = new Set(index.split(','));
  const hidden = targets.filter((target) => !showsTarget(scope, target)).map(({ name }) => name);
  const refused = hidden.find((name) => named.has(name));
  if (refused !== undefined) throw notShown(refused);
  const all = hidden.length === targets.length && hidden.length > 0;
  if (all || hidden.length > maxExclusions) throw tooWide(hidden.length, all);
  return hidden;
}

/**
 * Narrows a search to the indices its connector shows.
 *
 * @param scope - The connector's scope.
 * @param query - The bound search.
 * @param instance - The open connection, which resolves the index expression.
 * @param signal - Aborted when the caller gives up or the timeout passes.
 * @returns The query, with the hidden names its patterns reach excluded.
 * @throws {QueryError} `invalid` when the query names a hidden index or alias, or its pattern is
 *   too wide.
 * @throws {ConnectorError} When the source cannot resolve the expression.
 */
export async function narrowSearch(
  scope: ObjectScope,
  query: SearchQuery,
  instance: ConnectorInstance,
  signal: AbortSignal,
): Promise<SearchQuery> {
  if (!restricts(scope)) return query;
  if (!instance.resolveObjects) {
    if (!query.index.includes('*')) return query;
    throw new QueryError(
      'invalid',
      'This connector hides some indices and its kind cannot resolve a pattern. Name each index.',
    );
  }
  const targets = await instance.resolveObjects(query.index, signal);
  const hidden = hiddenTargets(scope, query.index, targets);
  if (hidden.length === 0) return query;
  return { ...query, index: [query.index, ...hidden.map((name) => `-${name}`)].join(',') };
}
