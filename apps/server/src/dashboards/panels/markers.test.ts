import { describe, expect, test } from 'bun:test';
import type { DashboardSpec } from '@quanthea/shared';
import { applyEdit } from './edit.ts';
import { edit, firstBuild, issuesOf, specOf } from './fixtures.ts';

/** Deploys from a table of the SQL connector. */
const deploys = {
  id: 'deploys',
  label: 'deploy',
  connector: 'shop',
  table: 'deploys',
  time: 'deployed_at',
  text: 'version',
};

/** Incidents from a raw SQL query. */
const incidents = {
  id: 'incidents',
  label: 'incident',
  data: {
    kind: 'raw',
    connector: 'shop',
    language: 'sql',
    query:
      'SELECT opened_at AS time, title AS text FROM incidents WHERE opened_at BETWEEN :__from AND :__to',
  },
};

/**
 * The sets of markers each chart shows, by panel id, for the charts that show any.
 *
 * @param spec - The spec.
 * @returns The set ids by panel id.
 */
function markedPanels(spec: DashboardSpec): Record<string, string[]> {
  return Object.fromEntries(
    spec.panels.flatMap((panel) =>
      panel.view.kind === 'chart' && panel.view.markers
        ? [[panel.id, panel.view.markers.map((marker) => marker.annotation)]]
        : [],
    ),
  );
}

/**
 * The dashboard of the first build with the given sets of markers.
 *
 * @param markers - The sets.
 * @returns The spec.
 */
function markedWith(...markers: unknown[]): DashboardSpec {
  return specOf(specOf(undefined, firstBuild), edit({ markers, summary: 'markers' }));
}

describe('sets of markers', () => {
  test('puts a set on every time chart, and takes it off', () => {
    const marked = markedWith(deploys);
    expect(markedPanels(marked)).toEqual({ latency: ['deploys'], 'orders-by-status': ['deploys'] });
    expect(marked.annotations.map((annotation) => annotation.color)).toEqual(['@ink']);
    expect(issuesOf(marked)).toEqual([]);
    const cleared = specOf(marked, edit({ removeMarkers: ['deploys'], summary: 'none' }));
    expect(cleared.annotations).toEqual([]);
    expect(markedPanels(cleared)).toEqual({});
  });

  test('takes a set from a query in any language, on the charts the edit names', () => {
    const data = { kind: 'raw', connector: 'logs', language: 'logql', query: '{app="pager"}' };
    const marked = markedWith({ ...incidents, data, color: '@palette.5', panels: ['Latency'] });
    expect(marked.annotations).toEqual([
      {
        id: 'incidents',
        label: 'incident',
        color: '@palette.5',
        query: { refId: 'M', connector: 'logs', language: 'logql', expr: '{app="pager"}' },
        timeField: 'time',
        textField: 'text',
      },
    ]);
    expect(markedPanels(marked)).toEqual({ latency: ['incidents'] });
  });

  test('keeps several sets apart, each in a colour of its own and on its own charts', () => {
    const marked = markedWith(deploys, { ...incidents, panels: ['latency'] });
    expect(marked.annotations.map(({ id, color }) => [id, color])).toEqual([
      ['deploys', '@ink'],
      ['incidents', '@palette.5'],
    ]);
    expect(markedPanels(marked)).toEqual({
      latency: ['deploys', 'incidents'],
      'orders-by-status': ['deploys'],
    });
    expect(issuesOf(marked)).toEqual([]);
  });

  test('replaces a set by id and removes another, leaving the rest as they were', () => {
    const marked = markedWith(deploys, { ...incidents, panels: ['latency'] });
    const flags = { ...incidents, id: 'flags', label: 'flag', panels: ['orders-by-status'] };
    const changed = specOf(
      marked,
      edit({
        markers: [{ ...deploys, label: 'release', panels: ['latency'] }, flags],
        removeMarkers: ['incidents'],
        summary: 'changed',
      }),
    );
    expect(changed.annotations.map(({ id, label, color }) => [id, label, color])).toEqual([
      ['deploys', 'release', '@ink'],
      ['flags', 'flag', '@palette.5'],
    ]);
    expect(markedPanels(changed)).toEqual({
      latency: ['deploys'],
      'orders-by-status': ['flags'],
    });
    const untouched = specOf(changed, edit({ title: 'Checkout, again', summary: 'title' }));
    expect(untouched.annotations).toEqual(changed.annotations);
    expect(markedPanels(untouched)).toEqual(markedPanels(changed));
  });

  test('keeps a set on a rebuilt chart, and adds it to new charts when every chart has it', () => {
    const everyChart = markedWith(deploys, { ...incidents, panels: ['latency'] });
    const memory = {
      title: 'Memory',
      data: { kind: 'gauge', connector: 'prom', metric: 'process_resident_memory_bytes' },
      chart: { recipe: 'trend.line' },
    };
    const rebuilt = { ...memory, title: 'Latency', replaces: 'latency' };
    const grown = specOf(everyChart, edit({ panels: [rebuilt, memory], summary: 'more' }));
    expect(markedPanels(grown)).toEqual({
      latency: ['deploys', 'incidents'],
      'orders-by-status': ['deploys'],
      memory: ['deploys'],
    });
  });

  test('binds the variables of a set, from its filters or its query, like a panel', () => {
    const filters = [{ field: 'service', value: '$service' }];
    const query = `${incidents.data.query} AND service IN (:service)`;
    const marked = markedWith(
      { ...deploys, filters },
      { ...incidents, data: { ...incidents.data, query } },
    );
    expect(marked.annotations.map((annotation) => annotation.query)).toMatchObject([
      {
        sql: 'SELECT "deployed_at" AS time, "version"::text AS text FROM "deploys" WHERE "deployed_at" BETWEEN :__from AND :__to AND "service" IN (:service) ORDER BY 1',
      },
      { sql: query },
    ]);
    expect(issuesOf(marked)).toEqual([]);
  });

  test('reports a variable the dashboard does not declare, in a filter or a query', () => {
    const query = `${incidents.data.query} AND team = :team`;
    const marked = markedWith(
      { ...deploys, filters: [{ field: 'service', value: '$nope' }] },
      { ...incidents, data: { ...incidents.data, query } },
    );
    expect(issuesOf(marked)).toEqual([
      'annotations[0].query.sql: Unknown variables: :nope.',
      'annotations[1].query.sql: Unknown variables: :team.',
    ]);
  });

  test('says when an edit names a set or a panel wrongly', () => {
    const built = specOf(undefined, firstBuild);
    const failing = (input: Record<string, unknown>) => () =>
      applyEdit(built, edit({ summary: 'm', ...input }));
    expect(failing({ markers: [{ ...deploys, panels: ['Top codes'] }] })).toThrow(
      'Markers go on time charts, and "Top codes" is not one.',
    );
    expect(failing({ markers: [{ ...deploys, panels: ['nope'] }] })).toThrow(
      'No panel "nope" to show the markers "deploys".',
    );
    expect(failing({ markers: [{ ...deploys, id: 'Deploys!' }] })).toThrow(
      'The markers id "Deploys!" is no slug',
    );
    expect(failing({ markers: [deploys, deploys] })).toThrow(
      'The markers "deploys" are named twice',
    );
    expect(failing({ removeMarkers: ['deploys'] })).toThrow(
      'No markers "deploys" to remove. The dashboard has none.',
    );
  });
});
