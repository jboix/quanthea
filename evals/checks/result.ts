/**
 * The result checks of a built dashboard: what a panel returned, compared with the truth computed
 * from the dev data on a path of its own. Two queries written differently pass when they return
 * the right numbers, and a query with the right words fails when it does not.
 */
import type { CheckContext, Truth } from '../core/case.ts';
import type { PanelResult, QuerySummary } from '../surfaces/panel-results.ts';
import type { DashboardCheck, Outcome } from './dashboard.ts';

/** How far a number may be from the truth. Each case says which, and how much. */
export interface Tolerance {
  /** The most it may differ by, as a share of the truth, such as `0.02` for 2%. */
  readonly relative?: number;
  /** The most it may differ by, in the number's own unit. */
  readonly absolute?: number;
  /**
   * The units a right number may be written in, as factors of the truth's: `[1, 0.001]` takes
   * milliseconds or seconds, `[1, 100]` a ratio or a percentage. Only the truth's when left out.
   */
  readonly scales?: readonly number[];
}

/**
 * Whether a number is the truth, within a tolerance, in one of the units allowed.
 *
 * @param actual - The number.
 * @param truth - The truth.
 * @param tolerance - How far it may be, and in which units.
 * @returns Whether it is.
 */
export function near(actual: number, truth: number, tolerance: Tolerance): boolean {
  const { relative = 0, absolute = 0, scales = [1] } = tolerance;
  return scales.some((scale) => {
    const wanted = truth * scale;
    return Math.abs(actual - wanted) <= Math.max(absolute * scale, Math.abs(wanted) * relative);
  });
}

/**
 * The numbers a panel shows as one number: a stat's, and every number of a result of one row.
 *
 * @param result - The panel's results.
 * @returns The numbers.
 */
function singleNumbers(result: PanelResult): number[] {
  const cells = result.queries
    .filter((query) => query.rowCount === 1)
    .flatMap((query) => query.rows[0] ?? [])
    .filter((cell): cell is number => typeof cell === 'number');
  return result.shown === undefined ? cells : [result.shown, ...cells];
}

/**
 * The truth a check compares with, as the trial computed it.
 *
 * @param context - The truths.
 * @param truth - The truth wanted.
 * @returns The value, or nothing when it could not be computed.
 */
function truthOf<Value>(context: CheckContext, truth: Truth<Value>): Value | undefined {
  return (context.truth[truth.key] ?? undefined) as Value | undefined;
}

/**
 * A panel shows a number: the truth, within a tolerance. It reads a stat's number and every
 * result of one row, so a stat, a gauge and a one-row table all count.
 *
 * @param truth - The number, computed from the dev data.
 * @param tolerance - How far a panel's number may be from it, and in which units.
 * @returns The check.
 */
export function showsNumber(truth: Truth<number>, tolerance: Tolerance): DashboardCheck {
  const faults = (outcome: Outcome, context: CheckContext) => {
    const wanted = truthOf(context, truth);
    if (wanted === undefined) return [`the truth ${truth.key} could not be computed`];
    const shown = (outcome.results ?? []).flatMap(singleNumbers);
    if (shown.some((number) => near(number, wanted, tolerance))) return [];
    const seen = shown.length > 0 ? shown.slice(0, 6).join(', ') : 'no single number';
    return [`no panel shows ${truth.key} = ${wanted}: the panels show ${seen}`];
  };
  return { id: `shows-number:${truth.key}`, kind: 'result', added: true, truths: [truth], faults };
}

/**
 * The totals a result holds per group that the truth names, each near the truth.
 *
 * @param query - A query's result.
 * @param wanted - The truth, by group.
 * @param tolerance - How far a total may be from it.
 * @returns Whether every group of the truth is there, and near.
 */
function holdsTotals(
  query: QuerySummary,
  wanted: Readonly<Record<string, number>>,
  tolerance: Tolerance,
): boolean {
  const { totals } = query;
  if (!totals) return false;
  return Object.entries(wanted).every(([group, value]) => {
    const total = totals[group];
    return total !== undefined && near(total, value, tolerance);
  });
}

/**
 * A panel's result adds up, per group, to the truth: every group the truth names is there with
 * its total. Groups beside them, such as one for the rest, are allowed. It reads a result with one
 * number column per group or per series, so a breakdown and a count over time both count.
 *
 * @param truth - The total of each group, computed from the dev data.
 * @param tolerance - How far a total may be from it.
 * @returns The check.
 */
export function totalsMatch(
  truth: Truth<Record<string, number>>,
  tolerance: Tolerance,
): DashboardCheck {
  const faults = (outcome: Outcome, context: CheckContext) => {
    const wanted = truthOf(context, truth);
    if (wanted === undefined) return [`the truth ${truth.key} could not be computed`];
    const queries = (outcome.results ?? []).flatMap((result) => result.queries);
    if (queries.some((query) => holdsTotals(query, wanted, tolerance))) return [];
    const seen = queries.find((query) => query.totals)?.totals;
    return [
      `no panel adds up to ${truth.key} = ${JSON.stringify(wanted)}: ${seen ? `one adds up to ${JSON.stringify(seen)}` : 'none has a total per group'}`,
    ];
  };
  return { id: `totals-match:${truth.key}`, kind: 'result', added: true, truths: [truth], faults };
}
