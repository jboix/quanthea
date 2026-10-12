/**
 * Counts the dashboards that read an object a connector is about to stop showing, before the
 * change is saved: the drafts threads work on, and the pinned dashboards. A dashboard counts when
 * the change would refuse one of its queries, or when a search pattern of its reaches an index
 * the change hides.
 */
import {
  type DashboardSpec,
  dashboardSpecSchema,
  matchesObjectName,
  type ObjectUsage,
  resolveTimeRange,
} from '@quanthea/shared';
import {
  type ConnectorFacts,
  type ConnectorLookup,
  checkQueries,
  type MissingKind,
  queriesOf,
} from './check-queries.ts';

/** A change to what a connector shows, not saved yet. */
export interface VisibilityChange {
  /** The connector's name, as specs write it. */
  readonly connector: string;
  /** What validation would know of the connector once the change is saved. */
  readonly proposed: ConnectorFacts | MissingKind;
  /** The objects of its schema the connector shows now and the change hides. */
  readonly hides: readonly string[];
}

/** Where the counted specs come from. */
export interface UsageSources {
  /** Finds a connector by name, as it is now. */
  readonly lookup: ConnectorLookup;
  /** The latest spec of each thread outside the bin that names a connector. */
  readonly threadSpecs: (connector: string) => readonly { readonly spec: unknown }[];
  /** The pinned specs. */
  readonly pinnedSpecs: () => readonly { readonly spec: unknown }[];
  /** The current instant, for relative default times. */
  readonly now: number;
}

/**
 * Whether a search of a spec names a pattern that reaches an index the change hides. Such a search
 * still runs, without that index.
 *
 * @param spec - The spec.
 * @param change - The change.
 * @returns `true` when a pattern reaches a hidden index.
 */
function patternReachesHidden(spec: DashboardSpec, change: VisibilityChange): boolean {
  const patterns = queriesOf(spec).flatMap(({ query }) =>
    query.language === 'search' && query.connector === change.connector
      ? query.index.split(',').filter((item) => item.includes('*') && !item.startsWith('-'))
      : [],
  );
  return patterns.some((pattern) => change.hides.some((name) => matchesObjectName(pattern, name)));
}

/**
 * Whether a change would refuse a query of a spec that passes now.
 *
 * @param spec - The spec.
 * @param change - The change.
 * @param sources - The current connectors and the instant.
 * @returns `true` when validation finds an issue it does not find now.
 */
function refusesQuery(spec: DashboardSpec, change: VisibilityChange, sources: UsageSources) {
  const timeRange = resolveTimeRange(spec.time, sources.now);
  const proposed: ConnectorLookup = (name) =>
    name === change.connector ? change.proposed : sources.lookup(name);
  const known = new Set(checkQueries(spec, sources.lookup, timeRange).map((issue) => issue.path));
  return checkQueries(spec, proposed, timeRange).some((issue) => !known.has(issue.path));
}

/**
 * Whether a stored spec reads an object the change hides. A spec that no longer parses counts
 * for nothing: it cannot run either way.
 *
 * @param stored - The spec, as stored.
 * @param change - The change.
 * @param sources - The current connectors and the instant.
 * @returns `true` when it does.
 */
function readsHidden(stored: unknown, change: VisibilityChange, sources: UsageSources): boolean {
  const parsed = dashboardSpecSchema.safeParse(stored);
  if (!parsed.success) return false;
  const spec = parsed.data;
  if (!queriesOf(spec).some(({ query }) => query.connector === change.connector)) return false;
  return refusesQuery(spec, change, sources) || patternReachesHidden(spec, change);
}

/**
 * Counts the threads and the pinned dashboards that read an object a change hides. Nothing is
 * saved.
 *
 * @param change - The change.
 * @param sources - The specs to count in, the current connectors and the instant.
 * @returns The counts.
 */
export function countObjectUsage(change: VisibilityChange, sources: UsageSources): ObjectUsage {
  const count = (rows: readonly { readonly spec: unknown }[]) =>
    rows.filter((row) => readsHidden(row.spec, change, sources)).length;
  return {
    threads: count(sources.threadSpecs(change.connector)),
    pinned: count(sources.pinnedSpecs()),
  };
}
