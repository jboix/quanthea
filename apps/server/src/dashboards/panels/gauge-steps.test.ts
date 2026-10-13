import { describe, expect, test } from 'bun:test';
import { completeCharts } from './complete.ts';
import { applyEdit } from './edit.ts';
import { edit, issuesOf, testOf } from './fixtures.ts';

describe('the steps of a gauge', () => {
  /** Thresholds of a share: good under 0.7, a warning up to 0.9, bad above. */
  const mappings = [
    { match: { to: 0.7 }, tone: 'good' as const },
    { match: { from: 0.7, to: 0.9 }, tone: 'warning' as const },
    { match: { from: 0.9 }, tone: 'bad' as const },
  ];

  /**
   * A panel of one number drawn by a chart recipe with options, completed and validated.
   *
   * @param recipe - The recipe's id.
   * @param options - The chart's options.
   * @returns The view and the issues of the spec.
   */
  function panelOf(recipe: string, options: object) {
    const panel = {
      title: 'Disk used',
      data: { kind: 'sql-stat', connector: 'shop', table: 'orders' },
      chart: { recipe, unit: 'percent', options },
    };
    const built = applyEdit(undefined, edit({ title: 'Shop', panels: [panel], summary: 'x' }));
    const tests = [testOf('disk-used', [{ name: 'value', type: 'number' }], [[0.72]])];
    const completed = completeCharts(built.spec, built.charts, tests);
    return { view: completed.spec.panels[0]?.view, issues: issuesOf(completed.spec) };
  }

  test('are taken from the options into the view, and the option keeps none', () => {
    const { view, issues } = panelOf('kpi.gauge', { mappings, series: { max: 1 } });
    expect(issues).toEqual([]);
    expect(view).toMatchObject({ kind: 'chart', prepare: 'gauge', mappings });
    expect(view?.kind === 'chart' && Object.keys(view.option)).toEqual(['series']);
  });

  test('refuse a colour for a tone, and a mapping that is no range', () => {
    const colored = panelOf('kpi.gauge', { mappings: [{ match: { from: 0.9 }, tone: '#d00' }] });
    expect(colored.issues[0]).toStartWith('panels[0].view.mappings[0].tone: ');
    const valued = panelOf('kpi.gauge', { mappings: [{ match: { value: 1 }, tone: 'bad' }] });
    expect(valued.issues).toEqual([
      'panels[0].view.mappings[0]: A step of a gauge is a range with a tone, such as { "match": { "from": 0.9 }, "tone": "bad" }.',
    ]);
  });

  test('are refused on a chart that is not a gauge', () => {
    const { issues } = panelOf('trend.sparkline', { mappings });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toStartWith('panels[0].view.mappings: Among the charts only a gauge');
  });
});
