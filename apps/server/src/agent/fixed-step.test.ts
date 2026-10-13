import { describe, expect, test } from 'bun:test';
import { alertSpecSchema, type DashboardSpec } from '@quanthea/shared';
import { specInput } from '../alerts/test/fixtures.ts';
import {
  alertStepIssues,
  bucketChangeNote,
  fixedStepProblems,
  withProblems,
} from './fixed-step.ts';

const fixed = "SELECT date_trunc('minute', at) AS time, count(*) AS errors FROM logs GROUP BY 1";
const follows =
  'SELECT date_bin(:__interval::interval, at, :__from) AS time, count(*) AS errors FROM logs GROUP BY 1';

/**
 * A panel of a report's dashboard.
 *
 * @param id - Its id.
 * @param sql - Its query.
 * @param overTime - Whether it is a chart over time.
 * @returns The panel.
 */
function panel(id: string, sql: string, overTime = true) {
  const option = { xAxis: { type: overTime ? 'time' : 'category' }, series: [{ type: 'line' }] };
  return {
    id,
    title: id,
    grid: { x: 0, y: 0, w: 6, h: 6 },
    queries: [{ refId: 'A', connector: 'logs', language: 'sql', sql }],
    view: { kind: 'chart', option, datasets: [{ ref: 'A' }] },
  };
}

/**
 * A dashboard with panels.
 *
 * @param panels - The panels.
 * @returns The spec, as far as the check reads it.
 */
const dashboard = (...panels: ReturnType<typeof panel>[]) =>
  ({ panels }) as unknown as DashboardSpec;

describe('the time charts a report writes', () => {
  test('have a problem when a query cuts time by a width of its own', () => {
    const problems = fixedStepProblems(undefined, dashboard(panel('trend', fixed)));
    expect(problems.get('trend')).toEqual([
      expect.stringMatching(
        /^query A: the query cuts time by a fixed width.*"\$__interval".*period\.$/,
      ),
    ]);
  });

  test('have none when the query follows the interval, or the chart is not over time', () => {
    const spec = dashboard(panel('trend', follows), panel('by-service', fixed, false));
    expect(fixedStepProblems(undefined, spec).size).toBe(0);
  });

  test('are not checked again when the edit leaves their queries as they were', () => {
    const before = dashboard(panel('old', fixed));
    const after = dashboard(panel('old', fixed), panel('new', fixed));
    expect([...fixedStepProblems(before, after).keys()]).toEqual(['new']);
  });

  test('add to the problems the test run found', () => {
    const run = { tests: [], panelProblems: new Map([['trend', ['the chart is empty']]]) };
    const more = new Map([['trend', ['query A: fixed']]]);
    expect(withProblems(run, more).panelProblems.get('trend')).toEqual([
      'the chart is empty',
      'query A: fixed',
    ]);
  });
});

/**
 * An alert's SQL query.
 *
 * @param sql - Its text.
 * @returns The query, as JSON.
 */
const sqlQuery = (sql: string) => ({ refId: 'A', connector: 'logs', language: 'sql', sql });

describe('the queries an alert writes', () => {
  test('are refused when they cut time by a width of their own', () => {
    const merged = specInput({ query: sqlQuery(fixed), variables: [] });
    expect(alertStepIssues(merged, { query: {} })).toEqual([
      { path: 'query', message: expect.stringContaining(':__interval') },
    ]);
  });

  test('pass when they follow the interval, and a PromQL query when it sets no step', () => {
    const merged = specInput({ query: sqlQuery(follows), variables: [] });
    expect(alertStepIssues(merged, { query: {} })).toEqual([]);
    expect(alertStepIssues(specInput(), { query: {} })).toEqual([]);
    const stepped = specInput({ query: { ...(specInput().query as object), step: '15s' } });
    expect(alertStepIssues(stepped, { query: {} })[0]?.message).toContain('leave "step" out');
  });

  test('are not checked when the edit leaves them as they were', () => {
    const merged = specInput({ query: sqlQuery(fixed), variables: [] });
    expect(alertStepIssues(merged, {})).toEqual([]);
  });

  test('include the second query of a ratio, at its own path', () => {
    const second = { query: { ...sqlQuery(fixed), refId: 'B' } };
    const merged = specInput({ query: sqlQuery(follows), variables: [], dividedBy: second });
    expect(alertStepIssues(merged, { dividedBy: second })).toEqual([
      { path: 'dividedBy.query', message: expect.stringContaining('fixed width') },
    ]);
    expect(alertStepIssues(merged, { dividedBy: 'none' })).toEqual([]);
  });

  test('say nothing of a spec that does not parse', () => {
    expect(alertStepIssues({ query: sqlQuery(fixed) }, { query: {} })).toEqual([]);
  });
});

describe('a lookback that moves to another interval', () => {
  /**
   * An alert spec with a lookback and a query.
   *
   * @param lookback - The lookback.
   * @param query - The query; the fixture's PromQL query when left out.
   * @returns The parsed spec.
   */
  const spec = (lookback: string, query?: unknown) =>
    alertSpecSchema.parse(specInput({ lookback, ...(query ? { query, variables: [] } : {}) }));

  test('tells the model that the buckets changed width under the threshold', () => {
    const note = bucketChangeNote(spec('1h', sqlQuery(follows)), spec('3h', sqlQuery(follows)));
    expect(note).toContain('buckets of 5m where 1h bound 1m');
  });

  test('says nothing when the interval stays, or when no query is cut by it', () => {
    const bucketed = sqlQuery(follows);
    expect(bucketChangeNote(spec('1h', bucketed), spec('90m', bucketed))).toBeUndefined();
    expect(bucketChangeNote(undefined, spec('3h', bucketed))).toBeUndefined();
    expect(
      bucketChangeNote(spec('1h', sqlQuery(fixed)), spec('3h', sqlQuery(fixed))),
    ).toBeUndefined();
    expect(bucketChangeNote(spec('1h'), spec('3h'))).toBeUndefined();
  });
});
