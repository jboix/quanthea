import { describe, expect, test } from 'bun:test';
import type { PanelQuery, View } from '@quanthea/shared';
import { alertCases } from './alert-cases.ts';
import { answerCases } from './answer-cases.ts';
import {
  eventsConnector,
  type ParityCase,
  type ParityExpectation,
  parityCases,
  selectParityCases,
} from './parity-cases.ts';
import { parityFamilies } from './parity-families.ts';
import { parityPlanOf, planParity, scoreParity, skippedLine } from './parity-score.ts';
import { questions } from './questions.ts';
import { scoreAll, summary } from './report.ts';
import { reportCases } from './report-cases.ts';
import type { BuiltPanel, Outcome } from './score.ts';
import { searchConnector } from './setup.ts';

/**
 * A parity question by its id.
 *
 * @param id - The id.
 * @returns The question.
 */
function caseOf(id: string): ParityCase {
  const found = parityCases.find((each) => each.id === id);
  if (!found) throw new Error(`No parity question ${id}.`);
  return found;
}

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
 * An expectation of one panel on the events connector with a view of its own.
 *
 * @param has - The fields the view must hold.
 * @param dashboard - The fields the dashboard must hold.
 * @returns The expectation.
 */
function expecting(has: readonly string[], dashboard: readonly string[] = []): ParityExpectation {
  return {
    connectors: [eventsConnector],
    panels: [1, 4],
    topics: [],
    maxRepairs: 1,
    shape: { view: { kind: 'table', has } },
    dashboard,
  };
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

describe('the parity families and their questions', () => {
  test('the families are f01 to f33, each once', () => {
    const ids = parityFamilies.map((family) => family.id);
    const wanted = Array.from(
      { length: 33 },
      (_, index) => `f${String(index + 1).padStart(2, '0')}`,
    );
    expect(ids).toEqual(wanted);
    expect(parityFamilies.every((family) => family.what.length > 0)).toBe(true);
  });

  test('every family has one question, which names it, in the families’ order', () => {
    expect(parityCases.map((each) => each.family)).toEqual(parityFamilies.map((each) => each.id));
    expect(parityCases.every((each) => each.id === each.family)).toBe(true);
  });

  test('no parity question shares its id with another question or case', () => {
    const others = [...questions, ...answerCases, ...alertCases, ...reportCases];
    const taken = new Set(others.map((each) => each.id));
    expect(parityCases.filter((each) => taken.has(each.id))).toEqual([]);
  });

  test('every question expects a shape, and queries the connector the world adds', () => {
    expect(eventsConnector).toBe(searchConnector);
    expect(parityCases.filter((each) => each.expect.shape === undefined)).toEqual([]);
    const elsewhere = parityCases.filter(
      (each) => !each.expect.connectors.includes(eventsConnector),
    );
    // The table of media reads the HTTP API alone.
    expect(elsewhere.map((each) => each.id)).toEqual(['f25']);
  });

  test('--only keeps them all by their word, some by their ids, and none otherwise', () => {
    expect(selectParityCases(['parity'])).toBe(parityCases);
    expect(selectParityCases(['q1', 'f05', 'f11']).map((each) => each.id)).toEqual(['f05', 'f11']);
    expect(selectParityCases([])).toEqual([]);
  });
});

describe('skipping the questions the world cannot answer', () => {
  test('a question with a need the world lacks is skipped, with what it lacks', () => {
    const plan = planParity(parityCases, []);
    expect(plan.skipped).toEqual([
      { id: 'f23', needs: ['http'] },
      { id: 'f24', needs: ['pinned-target'] },
      { id: 'f25', needs: ['http'] },
    ]);
    expect(plan.ready).toHaveLength(parityCases.length - 3);
    expect(plan.ready.some((each) => each.id === 'f23')).toBe(false);
  });

  test('it is asked once the world has what it needs', () => {
    const plan = planParity(parityCases, ['http']);
    expect(plan.skipped).toEqual([{ id: 'f24', needs: ['pinned-target'] }]);
    expect(planParity(parityCases, ['http', 'pinned-target']).ready).toEqual(parityCases);
  });

  test('a run plans the questions --only names, and needs the search connector for them', () => {
    expect(parityPlanOf(['f01', 'f23'], [], true)).toEqual({
      ready: [caseOf('f01')],
      skipped: [{ id: 'f23', needs: ['http'] }],
    });
    expect(parityPlanOf(['q1'], [], false)).toEqual({ ready: [], skipped: [] });
    expect(() => parityPlanOf(['parity'], [], false)).toThrow('add --search');
  });

  test('a skipped question is reported as skipped, not as a failure', () => {
    expect(skippedLine({ id: 'f23', needs: ['http'] })).toBe('f23: skipped, the world has no http');
    const { skipped } = planParity([caseOf('f01'), caseOf('f23')], []);
    const report = {
      startedAt: '2026-10-12T10:00:00.000Z',
      models: { model: 'a-model' },
      cache: { hits: 0, misses: 0 },
      results: scoreAll([built]),
      skipped,
    };
    const text = summary(report);
    expect(text).toContain('1 of 1 pass');
    expect(text).toContain('f23: skipped, the world has no http');
    expect(text).not.toContain('FAIL');
  });
});

describe('scoring a parity question', () => {
  test('passes a built panel of the shape its family expects', () => {
    expect(scoreParity(built, caseOf('f01').expect)).toEqual({ pass: true, reasons: [] });
  });

  test('a report scores a parity outcome against its question', () => {
    const [result] = scoreAll([{ ...built, id: 'f30' }]);
    expect(result?.score.reasons).toEqual([
      'events: no terms on data.error_type in the query',
      'events: the view has no legendValues=total',
    ]);
  });

  test('says each part of the shape a builder to come would give', () => {
    expect(scoreParity({ ...built, id: 'f11' }, caseOf('f11').expect).reasons).toEqual([
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
    expect(scoreParity(record, wanted)).toEqual({ pass: true, reasons: [] });
    const plain = tableOutcome({ columns: [{ field: 'browser' }], layout: 'rows' });
    expect(scoreParity(plain, wanted).reasons).toEqual([
      'events: the view has no columns.mappings.tone',
      'events: the view has no layout=record',
      'events: the view has no columns.field=median',
    ]);
  });

  test('reads a view kind that does not exist yet as a view of another kind', () => {
    expect(scoreParity({ ...built, id: 'f28' }, caseOf('f28').expect).reasons).toEqual([
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
    expect(scoreParity(poor, wanted).reasons).toEqual([
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
    expect(scoreParity(good, wanted)).toEqual({ pass: true, reasons: [] });
  });

  test('an outcome of an older report, with no dashboard on record, misses them all', () => {
    const { dashboard: _dashboard, ...old } = tableOutcome({ columns: [] });
    expect(scoreParity(old, expecting([], ['colors.tone'])).reasons).toEqual([
      'the dashboard has no colors.tone',
    ]);
  });

  test('a run that failed, or built nothing, says only that', () => {
    const wanted = expecting([], ['colors.tone']);
    expect(scoreParity({ ...built, error: 'quota' }, wanted).reasons).toEqual([
      'the run failed: quota',
    ]);
    expect(scoreParity({ ...built, built: false }, wanted).reasons).toEqual([
      'no dashboard was built',
    ]);
  });
});
