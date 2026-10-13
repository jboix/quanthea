/**
 * What a write of a report or an alert says of a query that cuts time by a step of its own. A
 * report's run cuts its time charts by the interval of its period, and an alert binds one interval
 * to its query in every read, so a width written into the query is refused, with what to write
 * instead. Panels and queries the edit leaves as they were are not checked again, so an older
 * one never blocks a new edit.
 */
import {
  type AlertSpec,
  alertSpecSchema,
  type DashboardSpec,
  defaultChartInterval,
  durationMs,
  fixedStepOf,
  followsChartInterval,
  type PanelQuery,
} from '@quanthea/shared';
import { isTimeChart } from '../dashboards/panels/index.ts';
import type { WriteRun } from './write-version.ts';

/** Why a report's time chart follows the interval. */
const reportReason = 'A run cuts its time charts by the interval of its period.';

/** Why an alert's query follows the interval. */
const alertReason =
  'An alert binds one interval to its query, by its lookback, in every check and in the replay.';

/**
 * The queries of a panel that cut time by a step of their own.
 *
 * @param queries - The panel's queries.
 * @returns A problem per such query, with what to write instead.
 */
function stepProblems(queries: readonly PanelQuery[]): string[] {
  return queries.flatMap((query) => {
    const why = fixedStepOf(query);
    return why ? [`query ${query.refId}: ${why}. ${reportReason}`] : [];
  });
}

/**
 * The problems of the time charts a report's edit writes: each query that cuts time by a step of
 * its own. A number, a table and a chart over categories are not checked.
 *
 * @param current - The spec before the edit, if any.
 * @param spec - The spec the edit makes, its charts completed.
 * @returns The problems, by panel id.
 */
export function fixedStepProblems(
  current: DashboardSpec | undefined,
  spec: DashboardSpec,
): Map<string, string[]> {
  const before = new Map(current?.panels.map((panel) => [panel.id, JSON.stringify(panel.queries)]));
  const written = spec.panels.filter(
    (panel) => isTimeChart(panel.view) && before.get(panel.id) !== JSON.stringify(panel.queries),
  );
  const found = written.map((panel) => [panel.id, stepProblems(panel.queries)] as const);
  return new Map(found.filter(([, problems]) => problems.length > 0));
}

/**
 * A test run with more problems on its panels.
 *
 * @param run - The test run and the problems found so far.
 * @param more - The problems to add, by panel id.
 * @returns The run with both.
 */
export function withProblems(
  run: WriteRun,
  more: ReadonlyMap<string, readonly string[]>,
): WriteRun {
  const panelProblems = new Map(run.panelProblems);
  for (const [id, problems] of more)
    panelProblems.set(id, [...(panelProblems.get(id) ?? []), ...problems]);
  return { ...run, panelProblems };
}

/** What of an alert's edit says which queries it writes. */
interface WrittenQueries {
  /** The alert's query, when the edit sets it. */
  readonly query?: unknown;
  /** The second query of a ratio, when the edit sets it; `none` takes it away. */
  readonly dividedBy?: unknown;
}

/**
 * The issues of the queries an alert's edit writes: each one that cuts time by a step of its own.
 * A spec that does not parse has none here: its own issues come first.
 *
 * @param merged - The spec the edit makes, as JSON.
 * @param edit - The edit, for the queries it sets.
 * @returns The issues, at `query` and `dividedBy.query`.
 */
export function alertStepIssues(
  merged: unknown,
  edit: WrittenQueries,
): { path: string; message: string }[] {
  const parsed = alertSpecSchema.safeParse(merged);
  if (!parsed.success) return [];
  const { query, dividedBy } = parsed.data;
  const second = typeof edit.dividedBy === 'object' ? dividedBy?.query : undefined;
  const written = [
    ...(edit.query ? [{ path: 'query', query }] : []),
    ...(second ? [{ path: 'dividedBy.query', query: second }] : []),
  ];
  return written.flatMap((each) => {
    const why = fixedStepOf(each.query);
    return why ? [{ path: each.path, message: `${why}. ${alertReason}` }] : [];
  });
}

/**
 * What an edit that moves an alert's lookback to another interval tells the model: the buckets
 * of a query that follows the interval change width with it, so a count per bucket is judged by
 * a threshold written for another width.
 *
 * @param before - The spec before the edit, if any.
 * @param after - The spec the edit makes.
 * @returns The note, or `undefined` when the interval stays or no query is cut by it.
 */
export function bucketChangeNote(
  before: AlertSpec | undefined,
  after: AlertSpec,
): string | undefined {
  if (!before) return undefined;
  const widthOf = (spec: AlertSpec) => defaultChartInterval(durationMs(spec.lookback));
  const [was, now] = [widthOf(before), widthOf(after)];
  const queries = [after.query, ...(after.dividedBy ? [after.dividedBy.query] : [])];
  const bucketed = queries.some(
    (query) => !['promql', 'logql'].includes(query.language) && followsChartInterval(query),
  );
  if (was === now || !bucketed) return undefined;
  return `The lookback of ${after.lookback} binds buckets of ${now} where ${before.lookback} bound ${was}, so each bucket of the query now covers another width. Read the values above against the threshold, and change it or tell the person if it no longer means the same.`;
}
