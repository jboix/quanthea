import { describe, expect, test } from 'bun:test';
import { completeCharts } from './complete.ts';
import { applyEdit } from './edit.ts';
import { edit, issuesOf, testOf } from './fixtures.ts';

describe('the mappings of a stat', () => {
  /**
   * A stat of the orders with options, completed and validated.
   *
   * @param options - The chart's options.
   * @returns The view and the issues of the spec.
   */
  function stat(options: object) {
    const panel = {
      title: 'Start time',
      data: { kind: 'sql-stat', connector: 'shop', table: 'orders' },
      chart: { recipe: 'kpi.stat', unit: 'seconds', options },
    };
    const built = applyEdit(undefined, edit({ title: 'Shop', panels: [panel], summary: 'x' }));
    const tests = [testOf('start-time', [{ name: 'value', type: 'number' }], [[3.1]])];
    const completed = completeCharts(built.spec, built.charts, tests);
    return { view: completed.spec.panels[0]?.view, issues: issuesOf(completed.spec) };
  }

  test('are taken from the options: thresholds as ranges, and how the tone is drawn', () => {
    const mappings = [
      { match: { to: 2 }, tone: 'good' as const },
      { match: { from: 2, to: 4 }, tone: 'warning' as const },
      { match: { from: 4 }, tone: 'bad' as const },
      { match: { null: true as const }, text: '0' },
    ];
    const { view, issues } = stat({ mappings, toneAs: 'background' });
    expect(issues).toEqual([]);
    expect(view).toMatchObject({ kind: 'stat', reduce: 'last', mappings, toneAs: 'background' });
  });

  test('refuse a colour for a tone, and a way of drawing that is not in the list', () => {
    const colored = stat({ mappings: [{ match: { from: 4 }, tone: '#d00' }] }).issues;
    expect(colored).toHaveLength(1);
    expect(colored[0]).toStartWith('panels[0].view.mappings[0].tone: ');
    expect(colored[0]).toContain('"warning"');
    expect(stat({ toneAs: 'border' }).issues[0]).toStartWith('panels[0].view.toneAs: ');
  });
});
