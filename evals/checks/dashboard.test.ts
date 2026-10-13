import { describe, expect, test } from 'bun:test';
import type { PanelQuery } from '@quanthea/shared';
import { scored } from '../core/test/scoring.ts';
import {
  type BuiltPanel,
  built,
  type DashboardCheck,
  everyPanelRuns,
  hasMarkers,
  markersFrom,
  markerTopic,
  maxRepairs,
  noDuplicateQueries,
  noFixedDates,
  type Outcome,
  panelCount,
  queries,
  shapeData,
  shapeView,
  topic,
} from './dashboard.ts';
import type { ShapeExpectation } from './shape.ts';

/** What a good dashboard holds, as a test writes it. */
interface Expectation {
  readonly connectors: readonly string[];
  readonly panels: readonly [number, number];
  readonly topics: readonly RegExp[];
  readonly maxRepairs: number;
  readonly markers?: { readonly topics: readonly RegExp[]; readonly connectors: readonly string[] };
  readonly shape?: ShapeExpectation;
}

/**
 * The checks of an expectation, in the order their faults are read.
 *
 * @param expect - What a good dashboard holds.
 * @returns The checks.
 */
function checksOf(expect: Expectation): DashboardCheck[] {
  const { markers, shape } = expect;
  return [
    built,
    panelCount(...expect.panels),
    everyPanelRuns,
    maxRepairs(expect.maxRepairs),
    ...expect.topics.map((pattern) => topic(pattern)),
    ...expect.connectors.map(queries),
    ...(markers ? [hasMarkers] : []),
    ...(markers?.topics ?? []).map(markerTopic),
    ...(markers?.connectors ?? []).map(markersFrom),
    ...(shape ? [shapeData(shape), shapeView(shape)] : []),
    noFixedDates,
    noDuplicateQueries,
  ];
}

/**
 * Scores an outcome against an expectation.
 *
 * @param outcome - What was built.
 * @param expect - What a good dashboard holds.
 * @returns Whether it passes, and what does not hold.
 */
function score(outcome: Outcome, expect: Expectation) {
  const { pass, reasons } = scored(checksOf(expect), outcome);
  return { pass, reasons };
}

const expectation: Expectation = {
  connectors: ['prometheus-dev', 'postgres-orders'],
  panels: [2, 4],
  topics: [/error/i, /deploy/i],
  maxRepairs: 1,
};

const outcome: Outcome = {
  id: 'q5',
  built: true,
  panels: [
    {
      id: 'errors',
      title: 'Error rate',
      connectors: ['prometheus-dev'],
      text: 'Error rate rate(...)',
    },
    {
      id: 'deploys',
      title: 'Deploys',
      connectors: ['postgres-orders'],
      text: 'Deploys SELECT ...',
    },
  ],
  failing: [],
  repairs: 0,
  asked: ['Which service?'],
  turns: 3,
  usage: {},
  durationMs: 1000,
};

describe('scoring an answer', () => {
  test('passes when every expectation holds', () => {
    expect(score(outcome, expectation)).toEqual({ pass: true, reasons: [] });
  });

  test('says each thing that does not hold', () => {
    const poor: Outcome = {
      ...outcome,
      panels: [outcome.panels[0] as Outcome['panels'][number]],
      failing: [{ panelId: 'errors', error: 'unknown label "region"' }],
      repairs: 3,
    };
    expect(score(poor, expectation).reasons).toEqual([
      '1 panels, expected 2 to 4',
      'errors fails: unknown label "region"',
      '3 failed writes, at most 1',
      'no panel about deploy',
      'never queries postgres-orders',
    ]);
  });

  test('counts the markers for their topic and their connector', () => {
    const markers = {
      id: 'markers',
      title: 'Markers: deploy',
      connectors: ['postgres-orders'],
      text: 'Markers: deploy\nSELECT ...',
    };
    const errorsOnly: Outcome = { ...outcome, panels: [outcome.panels[0] as BuiltPanel] };
    const single: Expectation = { ...expectation, panels: [1, 4] };
    expect(score(errorsOnly, single).reasons).toEqual([
      'no panel about deploy',
      'never queries postgres-orders',
    ]);
    expect(score({ ...errorsOnly, markers: [markers] }, single)).toEqual({
      pass: true,
      reasons: [],
    });
  });

  describe('when the answer needs markers', () => {
    const errorsOnly: Outcome = { ...outcome, panels: [outcome.panels[0] as BuiltPanel] };
    const needsMarkers: Expectation = {
      connectors: ['prometheus-dev'],
      panels: [1, 4],
      topics: [/error/i],
      maxRepairs: 1,
      markers: { topics: [/deploy/i], connectors: ['postgres-orders'] },
    };
    const marked = (id: string, connector: string, text: string): BuiltPanel => ({
      id,
      title: `Markers: ${id}`,
      connectors: [connector],
      text: `Markers: ${id}\n${text}`,
    });

    test('passes with a marker set on the topic, from the connector', () => {
      const deploys = marked('deploys', 'postgres-orders', 'SELECT * FROM deploys');
      const incidents = marked('incidents', 'prometheus-dev', 'ALERTS');
      expect(score({ ...errorsOnly, markers: [incidents, deploys] }, needsMarkers)).toEqual({
        pass: true,
        reasons: [],
      });
    });

    test('fails without markers, even with a panel on the topic', () => {
      expect(score(outcome, needsMarkers).reasons).toEqual(['no markers on the charts']);
    });

    test('fails markers on another topic, or from another connector', () => {
      const wrong = marked('incidents', 'prometheus-dev', 'ALERTS');
      expect(score({ ...errorsOnly, markers: [wrong] }, needsMarkers).reasons).toEqual([
        'no markers about deploy',
        'no markers from postgres-orders',
      ]);
    });
  });

  test('fails a query on a fixed time, and two panels running the same query', () => {
    const sql = (text: string) =>
      JSON.stringify([{ refId: 'A', connector: 'postgres-orders', language: 'sql', sql: text }]);
    const panel = (id: string, text: string) => ({
      id,
      title: id,
      connectors: ['postgres-orders', 'prometheus-dev'],
      text: `${id}\n${sql(text)}`,
    });
    const fixed: Outcome = {
      ...outcome,
      panels: [
        panel('deploys', "SELECT 1 FROM deploys WHERE deployed_at >= NOW() - INTERVAL '2 days'"),
        panel('errors', 'SELECT 1 FROM errors WHERE at BETWEEN :__from AND :__to'),
        panel('errors-again', 'SELECT 1 FROM errors WHERE at BETWEEN :__from AND :__to'),
      ],
    };
    expect(score(fixed, expectation).reasons).toEqual([
      'deploys: the query reads the current time',
      'errors-again runs the same query as errors',
    ]);
  });

  test('lets a stat and a chart share a query: a headline and its trend', () => {
    const query = JSON.stringify([
      { refId: 'A', connector: 'prometheus-dev', language: 'promql', expr: 'p95' },
    ]);
    const panel = (id: string, kind: string) => ({
      id,
      title: id,
      connectors: ['postgres-orders', 'prometheus-dev'],
      text: `${id}\n${query}`,
      kind,
    });
    const headline: Outcome = {
      ...outcome,
      panels: [panel('p95', 'stat'), panel('p95-over-time', 'chart'), panel('p95-again', 'stat')],
    };
    const reasons = score(headline, expectation).reasons;
    expect(reasons.filter((reason) => reason.includes('same query'))).toEqual([
      'p95-again runs the same query as p95',
    ]);
  });

  test('says only that no dashboard was built, whatever else would not hold', () => {
    const poor = { ...outcome, built: false, repairs: 9, panels: [] };
    expect(score(poor, expectation).reasons).toEqual(['no dashboard was built']);
  });

  test('ends a run that broke in an error, not a failure', () => {
    const broke = scored(checksOf(expectation), { ...outcome, error: '429 quota' });
    expect(broke.status).toBe('error');
  });
});

/** A search query: events over time, split by their name. */
const eventsOverTime: PanelQuery = {
  refId: 'A',
  connector: 'opensearch-dev',
  language: 'search',
  index: 'core_events',
  body: {
    size: 0,
    aggs: {
      time: {
        date_histogram: { field: '@timestamp', fixed_interval: '5m' },
        aggs: { name: { terms: { field: 'event_name', size: 5 } } },
      },
    },
  },
};

describe('scoring the shape of a panel', () => {
  const events: BuiltPanel = {
    id: 'events',
    title: 'Events over time',
    connectors: ['opensearch-dev'],
    text: 'Events over time',
    kind: 'table',
    queries: [eventsOverTime],
    builder: 'search-series',
    operations: ['pivot', 'calculate', 'sort'],
    view: {
      kind: 'table',
      ref: 'A',
      columns: [{ field: 'time' }, { field: 'START' }],
      sort: { field: 'time', dir: 'desc' },
    },
  };
  const reasonsOf = (panels: readonly BuiltPanel[], shape: ShapeExpectation) =>
    score(
      { ...outcome, panels },
      { connectors: [], panels: [1, 4], topics: [], maxRepairs: 1, shape },
    ).reasons;

  test('passes a panel asked of the builder, with the aggregations, operations and view', () => {
    const shape: ShapeExpectation = {
      builder: 'search-series',
      aggregations: ['date_histogram', 'terms:event_name'],
      operations: ['pivot', 'sort'],
      view: { kind: 'table', has: ['columns', 'sort.field'] },
    };
    expect(reasonsOf([outcome.panels[0] as BuiltPanel, events], shape)).toEqual([]);
  });

  test('says the builder, the aggregations and the operations that do not match', () => {
    const shape: ShapeExpectation = {
      builder: 'search-breakdown',
      aggregations: ['date_histogram', 'terms:session.media.bu', 'cardinality'],
      operations: ['sort', 'pivot'],
    };
    expect(reasonsOf([events], shape)).toEqual([
      'events: data asked as search-series, not search-breakdown',
      'events: no terms on session.media.bu in the query',
      'events: no cardinality in the query',
      'events: operations pivot, calculate, sort, not sort, pivot',
    ]);
  });

  test('says a wrong view, a wrong recipe and a missing view field', () => {
    const shape: ShapeExpectation = {
      view: { kind: 'chart', recipe: 'trend.line', has: ['sort', 'limit'] },
    };
    expect(reasonsOf([events], shape)).toEqual([
      'events: a table view, not a chart',
      'events: recipe not on record, not trend.line',
      'events: the view has no limit',
    ]);
  });

  test('reads the reasons on the panel closest to the shape', () => {
    const other: BuiltPanel = {
      ...events,
      id: 'other',
      kind: 'stat',
      builder: 'raw',
      operations: [],
    };
    const shape: ShapeExpectation = { builder: 'search-series', operations: ['join'] };
    expect(reasonsOf([other, events], shape)).toEqual([
      'events: operations pivot, calculate, sort, not join',
    ]);
  });

  test('reads a panel of an older report, which kept no queries and no view', () => {
    const old = outcome.panels[0] as BuiltPanel;
    const shape: ShapeExpectation = { builder: 'rate', view: { kind: 'chart' } };
    expect(reasonsOf([old], shape)).toEqual([
      'errors: data asked as nothing on record, not rate',
      'errors: no view on record',
    ]);
  });
});
