import { describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/shared';
import { completeCharts } from './complete.ts';
import { applyEdit } from './edit.ts';
import { edit, issuesOf, testOf } from './fixtures.ts';

describe('the columns of a table', () => {
  const errors = { field: 'errors', label: 'Errors', align: 'right' as const };
  const hosts = {
    title: 'Hosts',
    data: { kind: 'sql-rows', connector: 'shop', table: 'hosts', columns: ['host', 'errors'] },
    chart: { recipe: 'table.rows', options: { columns: [errors] } },
  };
  const fields: Frame['fields'] = [
    { name: 'host', type: 'string' },
    { name: 'errors', type: 'number' },
  ];
  const columns = [{ field: 'host' }, errors];

  test('keep the columns an option does not name, on a second write too', () => {
    const first = applyEdit(undefined, edit({ title: 'Hosts', panels: [hosts], summary: 'x' }));
    const tests = [testOf('hosts', fields, [['a'], [3]])];
    const built = completeCharts(first.spec, first.charts, tests);
    expect(built.problems.size).toBe(0);
    expect(built.spec.panels[0]?.view).toEqual({ kind: 'table', ref: 'A', columns });
    expect(issuesOf(built.spec)).toEqual([]);
    const second = applyEdit(built.spec, edit({ panels: [hosts], summary: 'again' }));
    const again = completeCharts(second.spec, second.charts, tests);
    expect(again.spec.panels.map((panel) => panel.view)).toEqual([
      { kind: 'table', ref: 'A', columns },
    ]);
  });

  test('refuse an option for a field the table does not show', () => {
    const chart = { recipe: 'table.rows', options: { columns: [{ field: 'region' }] } };
    const request = edit({ title: 'Hosts', panels: [{ ...hosts, chart }], summary: 'x' });
    const { spec, charts } = applyEdit(undefined, request);
    const completed = completeCharts(spec, charts, [testOf('hosts', fields, [['a'], [3]])]);
    expect(completed.problems.get('hosts')).toEqual([
      'options.columns names "region", which the table does not show. Its columns are "host", "errors": name a column to show in roles.columns.',
    ]);
  });

  /**
   * The table of hosts with mappings on its errors column, completed and validated.
   *
   * @param mappings - The mappings of the column.
   * @returns The view and the issues of the spec.
   */
  function mapped(mappings: object[]) {
    const options = { columns: [{ field: 'errors', mappings, toneAs: 'background' }] };
    const panel = { ...hosts, chart: { recipe: 'table.rows', options } };
    const built = applyEdit(undefined, edit({ title: 'Hosts', panels: [panel], summary: 'x' }));
    const tests = [testOf('hosts', fields, [['a'], [3]])];
    const completed = completeCharts(built.spec, built.charts, tests);
    return { view: completed.spec.panels[0]?.view, issues: issuesOf(completed.spec) };
  }

  test('take thresholds as range mappings with a tone, and refuse a colour', () => {
    const steps = [
      { match: { to: 5 }, tone: 'good' as const },
      { match: { from: 5 }, text: 'many', tone: 'bad' as const },
    ];
    expect(mapped(steps)).toEqual({
      view: {
        kind: 'table',
        ref: 'A',
        columns: [
          { field: 'host' },
          { field: 'errors', mappings: steps, toneAs: 'background' as const },
        ],
      },
      issues: [],
    });
    const colored = mapped([{ match: { from: 5 }, tone: 'red' }]).issues;
    expect(colored).toHaveLength(1);
    expect(colored[0]).toStartWith('panels[0].view.columns[1].mappings[0].tone: ');
    expect(colored[0]).toContain('"warning"');
  });

  /**
   * A table over a raw query, completed from a result without rows.
   *
   * @param chart - More of the chart, such as its roles.
   * @param empty - The result's fields: none for a result that tells no column.
   * @returns The completion.
   */
  function emptyRaw(chart: object, empty: Frame['fields']) {
    const data = { kind: 'raw', connector: 'shop', language: 'sql', query: 'SELECT * FROM hosts' };
    const panel = { title: 'Hosts', data, chart: { recipe: 'table.rows', ...chart } };
    const built = applyEdit(undefined, edit({ title: 'Hosts', panels: [panel], summary: 'x' }));
    const values = empty.map(() => []);
    return completeCharts(built.spec, built.charts, [testOf('hosts', empty, values)]);
  }

  test('are the fields of a raw result without rows, each with its option', () => {
    const completed = emptyRaw({ options: { columns: [errors] } }, fields);
    expect(completed.problems.size).toBe(0);
    expect(completed.spec.panels[0]?.view).toEqual({ kind: 'table', ref: 'A', columns });
  });

  test('are asked for when a raw result tells none, whatever the options name', () => {
    const problem =
      'The query returned no rows, so the table cannot tell its columns: name them in roles.columns.';
    expect(emptyRaw({ options: { columns: [errors] } }, []).problems.get('hosts')).toEqual([
      problem,
    ]);
    expect(emptyRaw({}, []).problems.get('hosts')).toEqual([problem]);
    const named = emptyRaw(
      { roles: { columns: ['host', 'errors'] }, options: { columns: [errors] } },
      [],
    );
    expect(named.problems.size).toBe(0);
    expect(named.spec.panels[0]?.view).toEqual({ kind: 'table', ref: 'A', columns });
  });
});
