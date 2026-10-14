import { describe, expect, test } from 'bun:test';
import type { PanelQuery, View } from '@quanthea/shared';
import {
  type BuiltPanel,
  type DashboardCheck,
  dashboardHas,
  type Outcome,
  shapeView,
  built as wasBuilt,
} from '../checks/dashboard.ts';
import { reasonsOf } from '../core/result.ts';
import { reportOf, scored, scoredCase } from '../core/test/scoring.ts';
import { searchConnector } from '../world/setup.ts';
import { defaultCases } from './index.ts';
import { eventsConnector, parityCases } from './parity.ts';
import { parityFamilies } from './parity-families.ts';

const eventsOverTime: PanelQuery = {
  refId: 'A',
  connector: eventsConnector,
  language: 'search',
  index: 'core_events',
  body: {
    size: 0,
    aggs: {
      time: {
        date_histogram: { field: '@timestamp', fixed_interval: { $var: '__interval' } },
        aggs: { series: { terms: { field: 'event_name', size: 10 } } },
      },
    },
  },
};

const events: BuiltPanel = {
  id: 'events',
  title: 'Events over time',
  connectors: [eventsConnector],
  text: `Events over time\n${JSON.stringify([eventsOverTime])}`,
  kind: 'chart',
  queries: [eventsOverTime],
  builder: 'search-series',
  recipe: 'trend.line',
  view: { kind: 'chart', prepare: 'cartesian', roles: {}, option: {}, datasets: [{ ref: 'A' }] },
};

const built: Outcome = {
  id: 'f01',
  built: true,
  panels: [events],
  dashboard: { specVersion: 1, title: 'Player events', variables: [] },
  failing: [],
  repairs: 0,
  asked: [],
  turns: 2,
  usage: {},
  durationMs: 1000,
};

/**
 * The checks of one table panel with a view of its own, and of the dashboard around it.
 *
 * @param has - The fields the view must hold.
 * @param dashboard - The fields the dashboard must hold.
 * @returns The checks.
 */
function expecting(has: readonly string[], dashboard: readonly string[] = []): DashboardCheck[] {
  return [wasBuilt, shapeView({ view: { kind: 'table', has } }), ...dashboard.map(dashboardHas)];
}

/**
 * The outcome of one table panel, with what a later view may hold.
 *
 * @param view - The view, as a later build writes it.
 * @param dashboard - The dashboard around the panel.
 * @returns The outcome.
 */
function tableOutcome(view: object, dashboard: Record<string, unknown> = {}): Outcome {
  const panel = { ...events, kind: 'table', view: { kind: 'table', ref: 'A', ...view } as View };
  return { ...built, panels: [panel], dashboard };
}

describe('the parity families and their cases', () => {
  test('the families are f01 to f33, each once', () => {
    const ids = parityFamilies.map((family) => family.id);
    const wanted = Array.from(
      { length: 33 },
      (_, index) => `f${String(index + 1).padStart(2, '0')}`,
    );
    expect(ids).toEqual(wanted);
    expect(parityFamilies.every((family) => family.what.length > 0)).toBe(true);
  });

  test('every family has one case, which names it, in the families’ order', () => {
    expect(parityCases.map((each) => each.family)).toEqual(parityFamilies.map((each) => each.id));
    expect(parityCases.every((each) => each.id === each.family)).toBe(true);
  });

  test('no parity case shares its id with another case', () => {
    const taken = new Set(defaultCases.map((each) => each.id));
    expect(parityCases.filter((each) => taken.has(each.id))).toEqual([]);
  });

  test('every case asks exactly, checks a shape, and queries the connector the world adds', () => {
    expect(eventsConnector).toBe(searchConnector);
    expect(parityCases.every((each) => each.bucket === 'capability')).toBe(true);
    const shaped = (ids: readonly string[]) => ids.some((id) => id.startsWith('shape-'));
    expect(parityCases.filter((each) => !shaped(each.checks.map((check) => check.id)))).toEqual([]);
    const elsewhere = parityCases.filter(
      (each) => !each.checks.some((check) => check.id === `queries:${eventsConnector}`),
    );
    // The table of media reads the HTTP API alone.
    expect(elsewhere.map((each) => each.id)).toEqual(['f25']);
  });

  test('every case needs the search connector, and three need more', () => {
    expect(parityCases.every((each) => each.given.needs?.includes('search'))).toBe(true);
    const more = parityCases.filter((each) => (each.given.needs ?? []).length > 1);
    expect(more.map((each) => each.id)).toEqual(['f23', 'f24', 'f25']);
  });
});

describe('scoring a parity case', () => {
  test('passes a built panel of the shape its family expects', () => {
    expect(scoredCase('f01', built)).toEqual({ pass: true, reasons: [] });
  });

  test('a report scores a parity outcome against its case', () => {
    const trial = reportOf([{ ...built, id: 'f30' }]).results[0]?.trials[0];
    expect(trial ? reasonsOf(trial) : []).toEqual([
      'events: no terms on data.error_type in the query',
      'events: the view has no legendValues=total',
    ]);
  });

  test('says each part of the shape a builder to come would give', () => {
    expect(scoredCase('f11', { ...built, id: 'f11' }).reasons).toEqual([
      'events: data asked as search-series, not search-table',
      'events: no multi_terms in the query',
      'events: no cardinality on session_id in the query',
      'events: no bucket_script in the query',
      'events: no bucket_sort in the query',
      'events: a chart view, not a table',
    ]);
  });

  test('reads a field of any column, and a field with a value', () => {
    const columns = [{ field: 'browser' }, { field: 'median', mappings: [{ tone: 'good' }] }];
    const record = tableOutcome({ columns, layout: 'record' });
    const wanted = expecting(['columns.mappings.tone', 'layout=record', 'columns.field=median']);
    expect(scored(wanted, record).reasons).toEqual([]);
    const plain = tableOutcome({ columns: [{ field: 'browser' }], layout: 'rows' });
    expect(scored(wanted, plain).reasons).toEqual([
      'events: the view has no columns.mappings.tone',
      'events: the view has no layout=record',
      'events: the view has no columns.field=median',
    ]);
  });

  test('takes one of several fields between bars', () => {
    const wanted = expecting(['mappings.tone|layout=record']);
    expect(scored(wanted, tableOutcome({ layout: 'record' })).reasons).toEqual([]);
    expect(scored(wanted, tableOutcome({ layout: 'rows' })).reasons).toEqual([
      'events: the view has no mappings.tone or layout=record',
    ]);
  });

  test('reads a view kind that does not exist yet as a view of another kind', () => {
    expect(scoredCase('f28', { ...built, id: 'f28' }).reasons).toEqual([
      'events: data asked as search-series, not search-rows',
      'events: a chart view, not a logs',
      'events: the view has no message',
      'events: the view has no level.mappings',
    ]);
  });

  test('says the fields the dashboard misses around its panels', () => {
    const wanted = expecting([], ['variables.kind=computed', 'sections.repeat', 'colors.tone']);
    const variables = [{ kind: 'custom', name: 'platform' }];
    const poor = tableOutcome({ columns: [] }, { variables, colors: [] });
    expect(scored(wanted, poor).reasons).toEqual([
      'the dashboard has no variables.kind=computed',
      'the dashboard has no sections.repeat',
      'the dashboard has no colors.tone',
    ]);
    const good = tableOutcome(
      { columns: [] },
      {
        variables: [...variables, { kind: 'computed', name: 'live', as: 'list' }],
        sections: [{ id: 'by-platform', title: 'Platform', repeat: 'platform' }],
        colors: [{ value: 'Web', tone: 'series1' }],
      },
    );
    expect(scored(wanted, good).reasons).toEqual([]);
  });

  test('an outcome of an older report, with no dashboard on record, misses them all', () => {
    const { dashboard: _dashboard, ...old } = tableOutcome({ columns: [] });
    expect(scored(expecting([], ['colors.tone']), old).reasons).toEqual([
      'the dashboard has no colors.tone',
    ]);
  });

  test('a run that built nothing says only that, and one that failed ends in an error', () => {
    const wanted = expecting([], ['colors.tone']);
    expect(scored(wanted, { ...built, built: false }).reasons).toEqual(['no dashboard was built']);
    expect(scored(wanted, { ...built, error: 'quota' }).status).toBe('error');
  });
});
